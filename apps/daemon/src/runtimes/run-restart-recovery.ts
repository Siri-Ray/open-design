import type { TrackingRunTerminalTrigger } from '@open-design/contracts/analytics';

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled']);

export const RESTART_ERROR_CODE = 'DAEMON_RESTARTED';
export const RESTART_ERROR_MESSAGE =
  'Run interrupted because the daemon restarted.';

export interface RestartRecoverableDurableRunState {
  error?: string | null;
  errorCode?: string | null;
  exitCode?: number | null;
  signal?: string | null;
  status: string;
  terminalTrigger?: TrackingRunTerminalTrigger | null;
  terminalRecoveryReason?: 'daemon_restart' | 'analytics_incomplete';
  terminalAt?: number | null;
  updatedAt: number;
}

/**
 * When an interrupted Run last did anything: the newest event timestamp in its
 * log, or its last persisted update when the log carries none.
 *
 * A Run cut off by a crash, a force-quit or a power loss stopped then, not when
 * the daemon next started — which can be hours later. Ending it at restart time
 * made the turn header read "14h" (P0-24 N1).
 */
export function lastRecordedRunActivityAt(
  state: Pick<RestartRecoverableDurableRunState, 'updatedAt'>,
  events: ReadonlyArray<{ timestamp?: unknown }>,
): number {
  let last = Number.isFinite(state.updatedAt) ? state.updatedAt : 0;
  for (const record of events) {
    if (typeof record.timestamp === 'number' && Number.isFinite(record.timestamp)) {
      last = Math.max(last, record.timestamp);
    }
  }
  return last;
}

export function interruptDurableRunAfterDaemonRestart(
  state: RestartRecoverableDurableRunState,
  now = Date.now(),
  /** From `lastRecordedRunActivityAt`; the Run's terminal time when known. */
  lastRecordedAt?: number,
): boolean {
  if (TERMINAL_STATUSES.has(state.status)) return false;
  const endedAt =
    typeof lastRecordedAt === 'number' && lastRecordedAt > 0 && lastRecordedAt <= now
      ? lastRecordedAt
      : now;
  state.status = 'failed';
  state.updatedAt = endedAt;
  state.terminalAt = endedAt;
  state.exitCode = 1;
  state.signal = null;
  state.error = RESTART_ERROR_MESSAGE;
  state.errorCode = RESTART_ERROR_CODE;
  state.terminalTrigger = 'daemon_restart';
  state.terminalRecoveryReason = 'daemon_restart';
  return true;
}
