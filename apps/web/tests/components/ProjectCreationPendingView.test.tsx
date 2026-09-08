// @vitest-environment jsdom

// The optimistic project frame shown between Send and the daemon's create
// response (OPEND-2617). It must be built from the creation record alone —
// name, prompt, staged attachments — carry an inert copy of the real composer
// so the frame already reads as the project page, and start no project-owned
// request while the project does not exist yet.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectCreationPendingView } from '../../src/components/ProjectCreationPendingView';
import { I18nProvider } from '../../src/i18n';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function renderPending(overrides: Partial<Parameters<typeof ProjectCreationPendingView>[0]> = {}) {
  return render(
    <I18nProvider initial="en">
      <ProjectCreationPendingView
        projectName="Coffee shop landing page"
        prompt="Make a landing page for a coffee shop"
        agentId="claude"
        onBack={() => undefined}
        {...overrides}
      />
    </I18nProvider>,
  );
}

describe('ProjectCreationPendingView', () => {
  it('shows the sent prompt and the project name from the creation record alone', () => {
    renderPending();

    expect(screen.getByTestId('pending-project-title').textContent).toBe('Coffee shop landing page');
    expect(screen.getByText('Make a landing page for a coffee shop')).toBeTruthy();
    expect(screen.getByText('Preparing...')).toBeTruthy();
  });

  it('lists staged attachments as user-message chips in send order', () => {
    renderPending({
      attachments: [
        new File(['brief'], 'brief.txt', { type: 'text/plain' }),
        new File(['png'], 'mood.png', { type: 'image/png' }),
      ],
    });

    const chips = screen.getByTestId('pending-user-attachments').querySelectorAll('.user-attachment');
    expect(Array.from(chips).map((chip) => chip.textContent)).toEqual(['1brief.txt', '2mood.png']);
    expect(chips[1]!.className).toContain('staged-image');
    expect(chips[1]!.querySelector('img')?.getAttribute('src')).toBe('blob:preview');
    // The chips are labels, not openable files: nothing has been uploaded.
    expect(Array.from(chips).every((chip) => (chip as HTMLButtonElement).disabled)).toBe(true);
  });

  it('renders the real composer as an inert, non-sendable shell', () => {
    renderPending();

    const shell = screen.getByTestId('pending-chat-composer-shell');
    // React 18 drops the boolean `inert` prop, so the view sets the attribute
    // on the node itself; the assertion is on the DOM, not on props.
    expect(shell.hasAttribute('inert')).toBe(true);
    expect(shell.getAttribute('aria-disabled')).toBe('true');
    expect(shell.querySelector('.chat-composer, [data-testid="chat-composer"], form, textarea, [contenteditable]')).toBeTruthy();
    // The send affordance is present so the frame matches ProjectView, but
    // it can never fire: no project exists to send into.
    expect((screen.getByTestId('chat-send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('starts no project-owned request while the project is unconfirmed', async () => {
    renderPending({ attachments: [new File(['brief'], 'brief.txt', { type: 'text/plain' })] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const projectReads = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes('/api/projects/'));
    expect(projectReads).toEqual([]);
  });
});
