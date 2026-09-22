import type { FaultEvidence } from './automatic-diagnostics.js';

interface Run {
  id: string; agentId?: string; projectId?: string; conversationId?: string;
  retryAttemptCount?: number; manualResumeAttemptCount?: number; errorCode?: string;
  strategyTask?: { outcome?: string };
}
interface Event { id: number; event: string; timestamp: number; data: unknown }
export function createDiagnosticRunObserver(): (run: Run, event: Event) => FaultEvidence | null {
  const errors = new WeakMap<Run, Set<string>>();
  return (run, event) => {
    const fault = diagnosticFaultFromRun(run, event);
    if (!fault) return null;
    const seen = errors.get(run) ?? new Set<string>();
    errors.set(run, seen);
    const key = `${run.manualResumeAttemptCount ?? 0}:${run.retryAttemptCount ?? 0}`;
    if (fault.kind === 'terminal_failure' && seen.has(key)) return null;
    if (fault.kind === 'retry' && seen.has(`${run.manualResumeAttemptCount ?? 0}:${Math.max(0, (run.retryAttemptCount ?? 0) - 1)}`)) return null;
    if (fault.kind === 'run_error') seen.add(key);
    return fault;
  };
}
export function diagnosticFaultFromRun(run: Run, event: Event): FaultEvidence | null {
  const data = event.data && typeof event.data === 'object' ? event.data as Record<string, unknown> : {};
  let kind: string;
  if (event.event === 'error') kind = 'run_error';
  else if (event.event === 'run_retry_attempted') kind = 'retry';
  else if (event.event === 'agent' && data.type === 'diagnostic' && data.name === 'model_retry') kind = 'model_retry';
  else if (event.event === 'end' && run.strategyTask?.outcome === 'blocked') kind = 'logical_blocked';
  else if (event.event === 'end' && data.status === 'failed') kind = 'terminal_failure';
  else return null;
  return { sourceId: `run:${run.id}:${run.manualResumeAttemptCount ?? 0}:${event.id}`,
    kind, at: event.timestamp, runId: run.id,
    ...(run.agentId ? { agentId: run.agentId } : {}),
    ...(run.projectId ? { projectId: run.projectId } : {}),
    ...(run.conversationId ? { conversationId: run.conversationId } : {}),
    attempt: run.retryAttemptCount ?? 0,
    ...(run.errorCode ? { errorCode: run.errorCode } : {}), detail: data };
}
