import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Windows file-system tunneling cannot be triggered on CI hosts, so file identity
// (inode + creation time) is simulated per path while sizes stay real.
const identities = new Map<string, { ino: number; birthtimeMs: number }>();
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: async (path: string) => {
      const info = await actual.stat(path);
      const identity = identities.get(path);
      return identity ? Object.assign(info, identity) : info;
    },
  };
});

const { DiagnosticConsentFence } = await import('../src/services/diagnostic-consent.js');

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'diagnostic-rotation-')); identities.clear(); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function optedIn(latest: string) {
  await writeFile(latest, 'written before consent\n');
  identities.set(latest, { ino: 1, birthtimeMs: Date.now() - 60_000 });
  const fence = new DiagnosticConsentFence(dir, false);
  fence.change(true);
  await fence.baseline([{ name: 'logs/daemon/latest.log', absolutePath: latest, kind: 'text' }]);
  return fence;
}

it('admits a log re-created under a rotated name that inherited the prior creation time', async () => {
  const latest = join(dir, 'latest.log'); const previous = join(dir, 'previous.log');
  const fence = await optedIn(latest);
  const inherited = identities.get(latest)!.birthtimeMs;
  // Next launch: latest.log -> previous.log, then a new latest.log within the tunneling window.
  await writeFile(previous, 'written before consent\nafter consent\n');
  identities.set(previous, { ino: 1, birthtimeMs: inherited });
  await writeFile(latest, 'new session\n');
  identities.set(latest, { ino: 2, birthtimeMs: inherited });
  const [current, rotated] = await fence.apply([
    { name: 'logs/daemon/latest.log', absolutePath: latest, kind: 'text' },
    { name: 'logs/daemon/previous.log', absolutePath: previous, kind: 'text' },
  ]);
  expect(current).not.toHaveProperty('omitReason');
  expect(current).not.toHaveProperty('startOffset');
  // The rotated file keeps its identity, so only bytes after the boundary are read.
  expect(rotated).toMatchObject({ startOffset: 'written before consent\n'.length });
  expect(rotated).not.toHaveProperty('omitReason');
});

it('keeps omitting an unrelated file created before consent', async () => {
  const latest = join(dir, 'latest.log'); const other = join(dir, 'other.log');
  const fence = await optedIn(latest);
  await writeFile(other, 'older private text\n');
  identities.set(other, { ino: 3, birthtimeMs: identities.get(latest)!.birthtimeMs - 1 });
  const [result] = await fence.apply([{ name: 'logs/other.log', absolutePath: other, kind: 'text' }]);
  expect(result).toMatchObject({ omitReason: 'pre_consent_source' });
});
