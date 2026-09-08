// @vitest-environment jsdom

// A failed optimistic create rolls the user back to Home (OPEND-2617). The
// prompt survives through the persisted draft; the staged File objects cannot,
// so App hands them back through the composer stash and the remounted Home
// must pick them up so the retry sends the same payload.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../src/components/home-hero/PlaceholderCarousel', () => ({
  PlaceholderCarousel: () => null,
}));

vi.mock('../../src/collab/useWorkspaceContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/collab/useWorkspaceContext')>();
  return {
    ...actual,
    useWorkspaceContext: () => ({
      context: null,
      loading: false,
      failure: 'unsupported' as const,
    }),
  };
});

import { HomeView } from '../../src/components/HomeView';
import { I18nProvider } from '../../src/i18n';
import {
  stashHomeComposerAttachments,
  takeHomeComposerAttachments,
} from '../../src/state/home-composer-stash';
import { writeHomeGuideStage } from '../../src/components/home-hero/firstRunGuide';

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  window.localStorage.clear();
  takeHomeComposerAttachments();
});

function stubPluginsFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    if (typeof url === 'string' && url === '/api/plugins') {
      return new Response(JSON.stringify({ plugins: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
}

function renderHome(variant: 'page' | 'dock' = 'page') {
  writeHomeGuideStage('done');
  stubPluginsFetch();
  return render(
    <I18nProvider initial="en">
      <HomeView
        projects={[]}
        variant={variant}
        onSubmit={() => Promise.resolve(true)}
        onOpenProject={() => undefined}
        onViewAllProjects={() => undefined}
      />
    </I18nProvider>,
  );
}

describe('home composer attachment stash', () => {
  it('restores stashed attachments into the staged-file band on mount', async () => {
    stashHomeComposerAttachments([new File(['brief'], 'brief.txt', { type: 'text/plain' })]);

    renderHome();

    const band = await screen.findByTestId('home-hero-staged-files');
    expect(band.textContent).toContain('brief.txt');
    // The stash is a one-shot hand-off: nothing is left for a later mount.
    expect(takeHomeComposerAttachments()).toEqual([]);
  });

  it('leaves the stash alone when nothing was handed back', async () => {
    renderHome();

    await screen.findByTestId('home-hero-input');
    expect(screen.queryByTestId('home-hero-staged-files')).toBeNull();
  });

  it('does not let a non-page surface consume the page composer hand-off', async () => {
    const file = new File(['brief'], 'brief.txt', { type: 'text/plain' });
    stashHomeComposerAttachments([file]);

    renderHome('dock');

    await screen.findByTestId('home-hero-input');
    expect(screen.queryByTestId('home-hero-staged-files')).toBeNull();
    expect(takeHomeComposerAttachments()).toEqual([file]);
  });
});
