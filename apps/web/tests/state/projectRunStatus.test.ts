import { describe, expect, it } from 'vitest';
import type { ChatRunStatusResponse } from '@open-design/contracts';

import { foldRunsToProjectStatuses } from '../../src/state/projectRunStatus';

function run(over: Partial<ChatRunStatusResponse> & { status: ChatRunStatusResponse['status'] }) {
  return {
    id: `run-${Math.random()}`,
    projectId: 'p1',
    conversationId: null,
    assistantMessageId: null,
    agentId: 'claude',
    createdAt: 0,
    updatedAt: 1,
    ...over,
  } as ChatRunStatusResponse;
}

describe('foldRunsToProjectStatuses', () => {
  it('reports each terminal outcome under its own name', () => {
    const statuses = foldRunsToProjectStatuses([
      run({ projectId: 'ok', status: 'succeeded' }),
      run({ projectId: 'bad', status: 'failed' }),
      run({ projectId: 'stopped', status: 'canceled' }),
    ]);

    expect(statuses.get('ok')).toBe('succeeded');
    expect(statuses.get('bad')).toBe('failed');
    expect(statuses.get('stopped')).toBe('canceled');
  });

  it('keeps queued distinct from running', () => {
    // The daemon folds queued into running for its own consumers; this one
    // paces its indicator differently, so the distinction has to survive.
    const statuses = foldRunsToProjectStatuses([
      run({ projectId: 'waiting', status: 'queued' }),
      run({ projectId: 'working', status: 'running' }),
    ]);

    expect(statuses.get('waiting')).toBe('queued');
    expect(statuses.get('working')).toBe('running');
  });

  it('calls a succeeded run with unfinished declared work incomplete (#1247 / #1060)', () => {
    const statuses = foldRunsToProjectStatuses([
      run({ status: 'succeeded', endedWithUnfinishedWork: true }),
    ]);

    expect(statuses.get('p1')).toBe('incomplete');
  });

  it('lets a pending question outrank a succeeded run', () => {
    // The run that asked reports `succeeded` and exits, so without the
    // awaiting-input set a blocked project reads as finished.
    const runs = [run({ status: 'succeeded' })];

    expect(foldRunsToProjectStatuses(runs).get('p1')).toBe('succeeded');
    expect(foldRunsToProjectStatuses(runs, ['p1']).get('p1')).toBe('awaiting_input');
  });

  it('does not let a pending question mask a failure', () => {
    // Only `succeeded` is superseded — a failed or canceled run leaves nothing
    // to answer, and hiding the failure behind "needs input" would misdirect.
    expect(foldRunsToProjectStatuses([run({ status: 'failed' })], ['p1']).get('p1')).toBe('failed');
    expect(foldRunsToProjectStatuses([run({ status: 'canceled' })], ['p1']).get('p1')).toBe(
      'canceled',
    );
  });

  it('lets an in-flight run outrank finished history', () => {
    const statuses = foldRunsToProjectStatuses([
      run({ status: 'succeeded', updatedAt: 99 }),
      run({ status: 'running', updatedAt: 1 }),
    ]);

    expect(statuses.get('p1')).toBe('running');
  });

  it('picks the newest run within each of active and terminal', () => {
    expect(
      foldRunsToProjectStatuses([
        run({ status: 'succeeded', updatedAt: 1 }),
        run({ status: 'failed', updatedAt: 2 }),
      ]).get('p1'),
    ).toBe('failed');

    expect(
      foldRunsToProjectStatuses([
        run({ status: 'queued', updatedAt: 2 }),
        run({ status: 'running', updatedAt: 1 }),
      ]).get('p1'),
    ).toBe('queued');
  });

  it('omits projects it was told nothing about', () => {
    // A missing entry means "unknown", which the UI renders as an empty slot.
    // Defaulting to not_started here would assert something unverified.
    const statuses = foldRunsToProjectStatuses([run({ projectId: 'known', status: 'running' })]);

    expect(statuses.has('unknown')).toBe(false);
    expect(foldRunsToProjectStatuses([]).size).toBe(0);
  });

  it('ignores runs with no project', () => {
    expect(foldRunsToProjectStatuses([run({ projectId: null, status: 'running' })]).size).toBe(0);
  });
});
