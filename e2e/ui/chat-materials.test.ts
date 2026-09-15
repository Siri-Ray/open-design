import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { T } from '@/timeouts';

// The browser must load the shipped stylesheet entrypoint and CSS Modules:
// source declarations alone cannot detect a later opaque cascade override.
for (const theme of ['light', 'dark'] as const) {
  test(`[P1] chat materials follow ${theme} appearance and reduced transparency`, async ({ page, context }) => {
    test.setTimeout(T.xlong);
    await applyStandardMocks(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const recordMessageId = await seedConversation(page);
    await expect(page.getByTestId('chat-composer'), 'The seeded conversation must finish loading before measuring its materials')
      .toBeVisible({ timeout: T.long });
    await expect(page.getByTestId('question-form-summary')).toContainText('Confirmed');

    // The app currently forces light; explicitly exercise its existing dark
    // stylesheet seam, as the PR's dark-theme contract requires.
    await page.evaluate((appearance) => {
      document.documentElement.dataset.theme = appearance;
    }, theme);

    const record = page.locator(`[data-assistant-message-id="${recordMessageId}"] details`).first();
    if (await record.getAttribute('open') === null) {
      await record.locator(':scope > summary').click();
    }
    const thoughts = record.getByTestId('chat-foldable-summary-content')
      .filter({ hasText: /^Thoughts$/ }).locator('../..');
    if (await thoughts.getAttribute('open') === null) {
      await thoughts.locator(':scope > summary').click();
    }
    await expect(page.getByTestId('thinking-markdown')).toBeVisible();
    const command = page.locator('details').filter({ hasText: 'printf material-witness' }).last();
    if (await command.getAttribute('open') === null) {
      await command.locator(':scope > summary').click();
    }
    await expect(command.getByText('material-output', { exact: true })).toBeVisible();

    const form = page.locator('.question-form');
    const surfaces = [
      form,
      page.getByTestId('question-form-summary'),
      thoughts.locator(':scope > div'),
      command.locator(':scope > div > div'),
      page.getByTestId('chat-composer').locator('.composer-shell'),
    ];
    const cdp = await context.newCDPSession(page);
    for (const reduced of [false, true]) {
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-transparency', value: reduced ? 'reduce' : 'no-preference' }],
      });
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)).toBe(reduced);
      for (const surface of surfaces) {
        await expectMaterial(surface, theme, reduced, 'regular');
      }
      for (const child of ['.question-form-head', '.question-form-body']) {
        await expect(form.locator(child)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      }

      await page.getByTestId('conversation-history-trigger').click();
      await expectMaterial(page.getByTestId('conversation-history-menu'), theme, reduced, 'glass');
      await page.getByTestId('conversation-history-trigger').click();

      await page.getByTestId('workspace-tabs-dropdown-trigger').click();
      await expectMaterial(page.getByRole('listbox'), theme, reduced, 'glass');
      await page.getByRole('option', { name: 'Chat material witness', exact: true }).click();
      await expect(page.getByRole('listbox')).toBeHidden();
    }
    await cdp.detach();
  });
}

async function expectMaterial(
  surface: Locator,
  theme: 'light' | 'dark',
  reduced: boolean,
  tier: 'regular' | 'glass',
): Promise<void> {
  await expect(surface).toBeVisible();
  const tint = theme === 'light' ? '250, 250, 250' : '53, 53, 53';
  await expect(surface).toHaveCSS('background-color', reduced
    ? `rgb(${tint})`
    : `rgba(${tint}, ${tier === 'regular' ? '0.72' : '0.66'})`);
  await expect(surface).toHaveCSS('backdrop-filter', reduced
    ? 'none'
    : tier === 'regular' ? 'blur(24px) saturate(1.6)' : 'blur(28px) saturate(1.8)');
}

async function seedConversation(page: Page): Promise<string> {
  const created = await page.request.post('/api/projects', {
    data: {
      id: randomUUID(), name: 'Chat material witness', skillId: null, designSystemId: null,
      metadata: { kind: 'prototype', nameSource: 'user' },
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { project, conversationId } = await created.json() as {
    project: { id: string }; conversationId: string;
  };
  const form = (id: string) => `<question-form id="${id}" title="Material brief">${JSON.stringify({
    questions: [{ id: 'audience', label: 'Audience', type: 'radio', options: ['Editorial', 'Minimal'], required: true }],
  })}</question-form>`;
  const messages = [
    { role: 'assistant', content: form('answered'), events: [{ kind: 'text', text: form('answered') }] },
    { role: 'user', content: '[form answers — answered]\n- Audience: Editorial' },
    {
      role: 'assistant', content: 'Material record complete.', events: [
        { kind: 'thinking', text: 'Material reasoning witness' },
        { kind: 'tool_use', id: 'material-command', name: 'Bash', input: { command: 'printf material-witness' } },
        { kind: 'tool_result', toolUseId: 'material-command', content: 'material-output', isError: false },
        { kind: 'text', text: 'Material record complete.' },
      ],
    },
    { role: 'assistant', content: form('pending'), events: [{ kind: 'text', text: form('pending') }] },
  ];
  const createdAt = Date.now();
  for (const [index, message] of messages.entries()) {
    const response = await page.request.put(
      `/api/projects/${project.id}/conversations/${conversationId}/messages/${project.id}-material-${index}`,
      { data: { ...message, runStatus: 'succeeded', createdAt: createdAt + index } },
    );
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  await page.goto(`/projects/${project.id}/conversations/${conversationId}`);
  return `${project.id}-material-2`;
}
