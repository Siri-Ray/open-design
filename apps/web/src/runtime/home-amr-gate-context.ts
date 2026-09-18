import type { WorkspaceCollabContext } from '@open-design/contracts';

import {
  workspaceResourceReadContext,
  type WorkspaceContextState,
} from '../collab/useWorkspaceContext';

/**
 * How long a Home send waits for the shell's workspace identity read to
 * settle before giving up on gating the run. A cold context read completes
 * well inside this; a read that never completes is Cloud being unreachable.
 */
export const HOME_AMR_GATE_CONTEXT_SETTLE_MS = 6_000;
const POLL_MS = 50;

export type HomeAmrGateWorkspaceContext =
  | { kind: 'settled'; state: WorkspaceContextState; context: WorkspaceCollabContext | null }
  | { kind: 'unsettled' };

/**
 * The workspace context a Home OpenDesign Cloud send may gate its wallet on.
 *
 * INVARIANT: a send never gates on the account wallet while the shell's
 * workspace identity read is still in flight. The balance gate without a
 * scope reads the ACCOUNT (personal) wallet and, with no context to name an
 * audience, shows the owner's upgrade dialog. A Team member who clicks Send
 * before the identity read has settled (cold start, a workspace switch or a
 * sign-in still resolving) would therefore be told to upgrade a personal plan
 * for a Team wallet they cannot manage — the dialog the in-project gate, which
 * always has its project's scope, never shows them (OPEND-3300 follow-up).
 *
 * So: the exact read identity, when the shell has one; the legacy account path
 * only when the shell has SETTLED without one (an old daemon with no workspace
 * endpoint, or an authoritative "no workspace"); and while the read is in
 * flight, wait for it — bounded, because Home has no queue to park a send in.
 *
 * Send still never STARTS identity discovery: this only observes the read the
 * shell already has in flight.
 */
export async function awaitHomeAmrGateWorkspaceContext(
  read: () => WorkspaceContextState,
  options: { deadlineMs?: number } = {},
): Promise<HomeAmrGateWorkspaceContext> {
  const deadlineMs = options.deadlineMs ?? HOME_AMR_GATE_CONTEXT_SETTLE_MS;
  const startedAt = Date.now();
  for (;;) {
    const state = read();
    const context = state.failure === 'unsupported'
      ? null
      : workspaceResourceReadContext(state);
    if (context || !workspaceIdentityReadInFlight(state)) {
      return { kind: 'settled', state, context };
    }
    if (Date.now() - startedAt >= deadlineMs) return { kind: 'unsettled' };
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, POLL_MS);
    });
  }
}

/** The shell has announced an identity read it has not heard back from. */
export function workspaceIdentityReadInFlight(
  state: Pick<WorkspaceContextState, 'loading' | 'identityChangePending' | 'failure'>,
): boolean {
  if (state.failure === 'unsupported') return false;
  return Boolean(state.loading) || Boolean(state.identityChangePending);
}
