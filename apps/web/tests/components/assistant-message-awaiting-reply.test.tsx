// @vitest-environment jsdom

/**
 * OPEND-2744 — a run that ended on an unanswered `<question-form>` is not
 * "Done" from the user's side: the turn is waiting on them. The run title
 * (footer label, or the task activity card's state when one is shown) reads
 * "Awaiting your reply" until the immediate user reply submits or skips that
 * form, then falls back to the normal terminal wording.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AssistantMessage } from '../../src/components/AssistantMessage';
import { formatFormAnswers, splitOnQuestionForms } from '../../src/artifacts/question-form';
import type { AgentEvent, ChatMessage } from '../../src/types';

const FORM = [
  'Two quick questions first.',
  '<question-form id="brief" title="Quick brief">',
  JSON.stringify({
    questions: [{ id: 'audience', label: 'Audience', type: 'text' }],
  }),
  '</question-form>',
].join('\n');

const PARSED_FORM = (() => {
  const seg = splitOnQuestionForms(FORM).find((item) => item.kind === 'form');
  if (!seg || seg.kind !== 'form') throw new Error('fixture form did not parse');
  return seg.form;
})();

function formMessage(extraEvents: AgentEvent[] = []): ChatMessage {
  return {
    id: 'assistant-form',
    role: 'assistant',
    content: FORM,
    runStatus: 'succeeded',
    startedAt: 1_000,
    endedAt: 3_000,
    events: [...extraEvents, { kind: 'text', text: FORM }],
  } as ChatMessage;
}

const TOOL_EVENT: AgentEvent = {
  kind: 'tool_use',
  id: 'tool-1',
  name: 'Bash',
  input: { command: 'pnpm guard', description: 'Run guard' },
} as AgentEvent;

function footerLabel(container: HTMLElement): string {
  return container.querySelector('.assistant-footer .assistant-label')?.textContent ?? '';
}

describe('AssistantMessage run title while a question form waits (OPEND-2744)', () => {
  afterEach(() => cleanup());

  it('reads "Awaiting your reply" instead of Done on the last turn with an unanswered form', () => {
    const { container } = render(
      <AssistantMessage
        message={formMessage()}
        streaming={false}
        projectId="project-1"
        conversationId="conv-1"
        isLast
        onSubmitQuestionForm={() => undefined}
      />,
    );
    expect(footerLabel(container)).toBe('Awaiting your reply');
    expect(screen.queryByText('Done')).toBeNull();
  });

  it('returns to Done once the immediate user reply submits the form', () => {
    const { container } = render(
      <AssistantMessage
        message={formMessage()}
        streaming={false}
        projectId="project-1"
        conversationId="conv-1"
        isLast
        nextUserContent={formatFormAnswers(PARSED_FORM, { audience: 'Founders' })}
      />,
    );
    expect(footerLabel(container)).toBe('Done');
  });

  it('returns to Done once the form is skipped (skip submits through the same path)', () => {
    const { container } = render(
      <AssistantMessage
        message={formMessage()}
        streaming={false}
        projectId="project-1"
        conversationId="conv-1"
        isLast
        nextUserContent={formatFormAnswers(PARSED_FORM, {})}
      />,
    );
    expect(footerLabel(container)).toBe('Done');
  });

  it('does not hold an older turn open: a non-last form is locked, not awaiting', () => {
    const { container } = render(
      <AssistantMessage
        message={formMessage()}
        streaming={false}
        projectId="project-1"
        conversationId="conv-1"
        isLast={false}
      />,
    );
    expect(footerLabel(container)).toBe('Done');
  });

  it('does not wait on a form the run never closed (output limit hit mid-form)', () => {
    // An unterminated <question-form> renders neither a form nor a skip once
    // the run is terminal, so "Awaiting your reply" would point at nothing
    // and never clear. The label falls back to Done.
    const truncated = FORM.slice(0, FORM.indexOf('</question-form>') - 20);
    const message = { ...formMessage(), content: truncated, events: [{ kind: 'text', text: truncated }] } as ChatMessage;
    const { container } = render(
      <AssistantMessage
        message={message}
        streaming={false}
        projectId="project-1"
        conversationId="conv-1"
        isLast
        onSubmitQuestionForm={() => undefined}
      />,
    );
    expect(footerLabel(container)).toBe('Done');
    expect(screen.queryByText('Awaiting your reply')).toBeNull();
  });

  it('carries the same wording on the task activity card when tools ran before the form', () => {
    render(
      <AssistantMessage
        message={formMessage([TOOL_EVENT])}
        streaming={false}
        projectId="project-1"
        conversationId="conv-1"
        isLast
        onSubmitQuestionForm={() => undefined}
      />,
    );
    const activity = screen.getByTestId('task-activity-toggle');
    expect(activity.textContent).toContain('Awaiting your reply');
    expect(activity.textContent).not.toContain('Done');
    expect(activity.getAttribute('data-run-state')).toBe('completed');
  });
});
