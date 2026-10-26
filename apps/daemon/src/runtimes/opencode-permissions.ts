import os from 'node:os';

import { agentCapabilities } from './capabilities.js';
import type { RuntimeAgentDef } from './types.js';

export const OPENCODE_SKIP_PERMISSIONS_FLAG = '--dangerously-skip-permissions';
export const OPENCODE_WORKSPACE_DIR_FLAG = '--dir';

export const OPENCODE_PERMISSION_CAPABILITY = {
  helpArgs: ['run', '--help'],
  capabilityFlags: {
    [OPENCODE_SKIP_PERMISSIONS_FLAG]: 'skipPermissions',
  },
} satisfies Pick<RuntimeAgentDef, 'helpArgs' | 'capabilityFlags'>;

export function appendOpenCodePermissionBypass(args: string[], agentId: string): void {
  if (agentCapabilities.get(agentId)?.skipPermissions) {
    args.push(OPENCODE_SKIP_PERMISSIONS_FLAG);
  }
}

/**
 * Pin OpenCode's workspace to the resolved project directory.
 *
 * OpenCode does not treat its process cwd as the project: it walks up to the
 * nearest enclosing git root and adopts THAT as the worktree (verified with
 * `opencode debug scrap`, whose every registered project is a git root). A
 * managed project directory is not a git repository, and a development install
 * keeps the daemon data directory under the repository root — so OpenCode walks
 * past the project and adopts the whole Open Design checkout.
 *
 * The consequences are all silent: the agent names the repository root as its
 * workspace and writes the deliverable there, the project directory stays
 * empty, `snapshotProjectArtifactsAsync(cwd)` sees nothing, and the Run reports
 * `no_artifact`. `permission.external_directory` cannot catch it either — once
 * the repository is the worktree, writing inside it is an in-project write.
 *
 * Sent unconditionally, matching the BYOK OpenCode definition that already
 * carried this workaround. Gating it on the `--help` capability probe would
 * turn a missing flag back into the silent data-loss bug; an OpenCode build
 * without `--dir` should fail loudly at spawn instead.
 */
export function appendOpenCodeWorkspaceDir(
  args: string[],
  cwd: string | null | undefined,
): void {
  if (typeof cwd !== 'string' || cwd.length === 0) return;
  args.push(OPENCODE_WORKSPACE_DIR_FLAG, cwd);
}

/**
 * System temporary directories a headless OpenCode run may use.
 *
 * Agents write scratch files to temp paths on their own: thumbnails, ffmpeg
 * frames, browser probe scripts, usually as literal `/tmp/...` paths rather
 * than through `$TMPDIR`. Without an `external_directory` grant a headless
 * OpenCode run auto-rejects the follow-up read with "The user rejected
 * permission", and the model then ends the turn with no output.
 *
 * Codex's workspace-write sandbox makes `/tmp` and `$TMPDIR` writable by
 * default for the same reason. The caller's allowlist builder adds realpath
 * variants, so macOS `/private/tmp` and `/private/var/folders/...` follow.
 */
export function openCodeSystemTempDirectories(
  tmpdir: () => string = os.tmpdir,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return platform === 'win32' ? [tmpdir()] : Array.from(new Set([tmpdir(), '/tmp']));
}
