import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, expect, it } from 'vitest';
import { buildAutomaticDiagnostics } from '../src/automatic.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
it('streams text only, redacts JSONL secrets, and reports omissions and truncation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'diagnostic-auto-')); dirs.push(dir);
  await writeFile(join(dir, 'events'), '{"token":"hidden"}\n{"message":"failure"}\n[debug] {"apiKey":"prefixed-secret"}\n');
  await writeFile(join(dir, 'dump'), 'NEVER UPLOAD');
  const result = await buildAutomaticDiagnostics({ directory: join(dir, 'bundle'), incidentId: 'incident-a',
    summary: { error: 'Authorization: Bearer credential123' }, sources: [
      { name: 'events.jsonl', absolutePath: join(dir, 'events'), kind: 'text' },
      { name: 'crash.dmp', absolutePath: join(dir, 'dump'), kind: 'binary' },
      { name: 'missing.log', absolutePath: join(dir, 'missing'), kind: 'text' },
    ] });
  const chunks = await Promise.all(result.manifest.chunks.map((c) => readFile(join(dir, 'bundle', String(c.index)))));
  const text = gunzipSync(Buffer.concat(chunks)).toString();
  expect(text).not.toContain('hidden'); expect(text).not.toContain('credential123'); expect(text).not.toContain('NEVER UPLOAD');
  expect(text).not.toContain('prefixed-secret');
  expect(text).toContain('failure'); expect(text).toContain('missing.log');
  expect(result.manifest.completeness).toBe('partial');
  expect(result.manifest.compressedBytes).toBe(Buffer.concat(chunks).length);
});

it('keeps only selected lines of a shared log and notes when none belong to the incident', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'diagnostic-auto-')); dirs.push(dir);
  await writeFile(join(dir, 'shared'), '{"run":"a","message":"mine"}\n{"run":"b","message":"someone else"}\n');
  const pick = (run: string) => (lines: string[]) => lines.filter((line) => line.includes(`"run":"${run}"`));
  const result = await buildAutomaticDiagnostics({ directory: join(dir, 'bundle'), incidentId: 'incident-b', summary: {}, sources: [
    { name: 'shared.jsonl', absolutePath: join(dir, 'shared'), kind: 'text', selectLines: pick('a') },
    { name: 'shared-again.jsonl', absolutePath: join(dir, 'shared'), kind: 'text', selectLines: pick('c') },
  ] });
  const chunks = await Promise.all(result.manifest.chunks.map((c) => readFile(join(dir, 'bundle', String(c.index)))));
  const records = gunzipSync(Buffer.concat(chunks)).toString().trim().split('\n').map((line) => JSON.parse(line));
  expect(records.find((r) => r.name === 'shared.jsonl').content).toContain('mine');
  expect(JSON.stringify(records)).not.toContain('someone else');
  expect(records.at(-1).notes).toEqual([{ name: 'shared-again.jsonl', reason: 'no_matching_records' }]);
});
