// @vitest-environment jsdom
//
// A click on the Home type picker must open its menu even when it lands on the
// very commit that enabled the trigger. TemplatePicker used to close the menu
// from an effect on `[activeChipId, disabled]`; that reset is still pending
// when the enabling commit is clicked, and React flushes it after the click's
// own update, so the menu closed again at once. Under CI load
// `pickHomeTemplate`'s `waitFor` lands in that window
// (HomeView.skill-with-chip "keeps the 幻灯片 task type…").
//
// This spec clicks from a MutationObserver on the first commit that shows the
// trigger enabled — the same moment a user's click or a polling wait can hit.

import { act } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
import { homeTemplateTrigger } from '../helpers/home-template-picker';

function pluginRecord(id: string, title: string, tags: string[], od: Record<string, unknown>) {
  return {
    id,
    title,
    version: '0.1.0',
    trust: 'bundled' as const,
    sourceKind: 'bundled' as const,
    source: `/tmp/${id}`,
    capabilitiesGranted: ['prompt:inject'],
    fsPath: `/tmp/${id}`,
    installedAt: 0,
    updatedAt: 0,
    marketplaceTrust: 'official' as const,
    manifest: {
      name: id,
      title,
      version: '0.1.0',
      description: `${title} description.`,
      tags,
      od: {
        kind: 'scenario',
        taskKind: 'new-generation',
        useCase: { query: `Seeded brief for ${title}.` },
        ...od,
      },
    },
  };
}

const CATALOG = [
  pluginRecord('example-web-prototype', 'Web Prototype', ['prototype'], { mode: 'prototype' }),
  pluginRecord('example-simple-deck', 'Simple Deck', ['deck'], { mode: 'deck' }),
  pluginRecord('od-new-generation', 'New generation', [], {}),
  pluginRecord('od-media-generation', 'Media generation', [], {}),
];

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    if (url === '/api/plugins') return json({ plugins: CATALOG });
    if (url === '/api/mcp/servers') return json({ servers: [], templates: [] });
    return json({});
  }));
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(window.performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
}

describe('HomeView type picker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('stays open when clicked on the first commit that enables it', async () => {
    stubFetch();
    render(
      <HomeView
        projects={[]}
        skills={[]}
        onSubmit={() => undefined}
        onOpenProject={() => undefined}
      />,
    );
    const trigger = homeTemplateTrigger();
    expect(trigger.disabled).toBe(true);

    let clickedWith: string | null = null;
    const observer = new MutationObserver(() => {
      if (clickedWith !== null || trigger.disabled) return;
      clickedWith = screen.getByTestId('home-hero-template-picker').getAttribute('data-type') ?? '';
      fireEvent.click(trigger);
    });
    observer.observe(trigger, { attributes: true, attributeFilter: ['disabled'] });

    await waitFor(() => expect(clickedWith).not.toBeNull());
    observer.disconnect();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    // Home's default task type was already in place when the trigger unlocked,
    // so the only thing that could close the menu is the picker's own reset.
    expect(clickedWith).toBe('prototype');
    expect(screen.queryByTestId('home-hero-template-menu')).not.toBeNull();
  });
});
