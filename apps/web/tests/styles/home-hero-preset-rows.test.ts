// Measurement spec for the home template list (the rows under the composer
// once a type is picked) and the composer's placeholder caret — OPEND-2687,
// OPEND-2705, OPEND-2698. Values are pinned so a drift fails here before it
// reaches a screenshot.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const homeHeroCss = readFileSync(
  new URL('../../src/styles/home/home-hero.css', import.meta.url),
  'utf8',
);

function declarations(selector: string): string {
  const cssWithoutComments = homeHeroCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const rulePattern = /([^{}]+)\{([^}]*)\}/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(cssWithoutComments)) !== null) {
    const selectors = (match[1] ?? '').split(',').map((item) => item.trim());
    if (selectors.includes(selector)) blocks.push(match[2] ?? '');
  }
  return blocks.join('\n');
}

describe('home hero — template list rows', () => {
  it('OPEND-2687: the hover fill carries the same air above and below the row content', () => {
    const row = declarations('.home-hero__plugin-preset-row');
    // Symmetric vertical padding: the poster (56px) is the tallest thing in the
    // row, so equal padding on both sides is what centres it in the fill.
    expect(row).toMatch(/padding:\s*12px 16px;/);
    expect(row).toMatch(/align-items:\s*center/);
    // The row pitch is unchanged (12 + 56 + 12 = 80): the four-row viewport
    // below is cut to exactly this height and must stay in sync.
    expect(declarations('.home-hero__plugin-presets')).toMatch(/--preset-row-h:\s*80px/);
    expect(declarations('.home-hero__plugin-preset-row-thumb')).toMatch(/height:\s*56px/);
  });

  it('OPEND-2705: a light poster keeps a visible edge against the page', () => {
    // Default treatment pending product/design sign-off: a 1px hairline ring
    // over the poster, mixed down from the border token so it reads on a white
    // page in light mode without glaring in dark mode. Drawn by a pseudo
    // element ON TOP of the image (an inset box-shadow on the box itself would
    // be painted under the <img>).
    const ring = declarations('.home-hero__plugin-preset-row-thumb::after');
    expect(ring).toMatch(/content:\s*''/);
    expect(ring).toMatch(/position:\s*absolute/);
    expect(ring).toMatch(/inset:\s*0/);
    expect(ring).toMatch(/border-radius:\s*inherit/);
    expect(ring).toMatch(/pointer-events:\s*none/);
    expect(ring).toMatch(
      /box-shadow:\s*inset 0 0 0 1px color-mix\(in srgb, var\(--border\) 70%, transparent\)/,
    );
    // The thumb is the positioning context for that ring (and the eye badge).
    expect(declarations('.home-hero__plugin-preset-row-thumb')).toMatch(/position:\s*relative/);
  });
});

describe('home hero — placeholder caret', () => {
  it('OPEND-2698: the typewriter caret matches the native caret it stands in for', () => {
    const caret = declarations('.home-hero__carousel-caret');
    // Native Chromium caret on the 14px composer text: 1px wide, 17px tall
    // (font ascent + descent), in the editor's caret-color.
    expect(caret).toMatch(/width:\s*1px/);
    expect(caret).toMatch(/height:\s*17px/);
    expect(caret).toMatch(/align-self:\s*center/);
    expect(caret).toMatch(/background:\s*var\(--accent\)/);
    // No vertical margins: the height is explicit now, not derived from the
    // line box minus a margin — the old 3px pair is what shrank it to 14px.
    expect(caret).not.toMatch(/margin:\s*3px/);
    expect(caret).not.toMatch(/align-self:\s*stretch/);
    expect(caret).not.toMatch(/width:\s*1\.5px/);
    // Square ends, like the native caret — a 1px radius on a 1px bar rounds it off.
    expect(caret).not.toMatch(/border-radius/);
  });
});

describe('home hero — template row preview badge (OPEND-2697)', () => {
  // Product: the eye is a secondary affordance. It must not compete with the
  // row's "pick → fill the composer → send" main path, so it stays hidden at
  // rest, fades in with the row's hover (or keyboard focus), sits on a
  // translucent LIGHT ground rather than a dark scrim disc, and is one size
  // step smaller than before (20 → 16).
  const badge = declarations('.home-hero__plugin-preset-row-preview');
  const reveal = declarations(
    '.home-hero__plugin-preset-row:not(:disabled):hover .home-hero__plugin-preset-row-preview',
  );

  it('is hidden at rest and never a click target of its own', () => {
    expect(badge).toMatch(/opacity:\s*0;/);
    expect(badge).toMatch(/visibility:\s*hidden;/);
    expect(badge).toMatch(/pointer-events:\s*none;/);
  });

  it('is one size step smaller, on a translucent light ground with dark ink', () => {
    expect(badge).toMatch(/width:\s*16px;/);
    expect(badge).toMatch(/height:\s*16px;/);
    expect(declarations('.home-hero__plugin-preset-row-preview svg')).toMatch(/width:\s*11px;/);
    expect(badge).toMatch(/background:\s*color-mix\(in srgb, #fff 82%, transparent\);/);
    expect(badge).toMatch(/color:\s*#202020;/);
    // No dark scrim disc anywhere on the badge, at rest or under the poster's
    // own hover.
    expect(badge).not.toMatch(/#000 55%/);
    expect(declarations('.home-hero__plugin-preset-row-thumb:hover .home-hero__plugin-preset-row-preview'))
      .not.toMatch(/#000/);
  });

  it('fades in over ~200ms and out over ~140ms on the shared ease-out curve', () => {
    const curve = 'cubic-bezier\\(0\\.23, 1, 0\\.32, 1\\)';
    // Rest state carries the EXIT timing (the transition that runs when hover
    // leaves), hover carries the ENTER timing.
    expect(badge).toMatch(new RegExp(`opacity 140ms ${curve}`));
    expect(badge).toMatch(/visibility 0s linear 140ms/);
    expect(reveal).toMatch(/opacity:\s*1;/);
    expect(reveal).toMatch(/visibility:\s*visible;/);
    expect(reveal).toMatch(new RegExp(`opacity 200ms ${curve}`));
  });

  it('shows for keyboard focus on the row as well as pointer hover', () => {
    expect(
      declarations(
        '.home-hero__plugin-preset-row:not(:disabled):focus-visible .home-hero__plugin-preset-row-preview',
      ),
    ).toMatch(/opacity:\s*1;/);
  });
});
