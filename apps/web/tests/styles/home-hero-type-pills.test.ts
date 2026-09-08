// Measurement spec for the type chips under the Home composer (原型 / 幻灯片 /
// 文档) — OPEND-2684. The three lead chips carry a visible 1px ring and each
// its own icon hue; the selected state is a light tint of that hue. Every
// other chip (更多, the rest of the row) stays neutral.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const homeHeroCss = readFileSync(
  new URL('../../src/styles/home/home-hero.css', import.meta.url),
  'utf8',
);
const tokensCss = readFileSync(
  new URL('../../src/styles/tokens.css', import.meta.url),
  'utf8',
);

function rules(css: string): Array<{ selectors: string[]; body: string }> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rulePattern = /([^{}]+)\{([^}]*)\}/g;
  const out: Array<{ selectors: string[]; body: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(withoutComments)) !== null) {
    out.push({
      selectors: (match[1] ?? '').split(',').map((item) => item.trim()),
      body: match[2] ?? '',
    });
  }
  return out;
}

function declarations(css: string, selector: string): string {
  return rules(css)
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.body)
    .join('\n');
}

const HUES = [
  ['prototype', '--type-prototype'],
  ['deck', '--type-deck'],
  ['document', '--type-document'],
] as const;

describe('home hero — type chips (OPEND-2684)', () => {
  it('every chip wears a clearly visible 1px ring on both themes', () => {
    const pill = declarations(homeHeroCss, '.home-hero__type-pill');
    // Mixed from the text ink, not a fixed light gray: 20% of --text is a
    // visible outline on a white page AND on the dark panel, where #EDEDED
    // used to vanish into the ground.
    expect(pill).toMatch(
      /border:\s*1px solid color-mix\(in srgb, var\(--text\) 20%, transparent\);/,
    );
  });

  it('the three lead chips each carry their own icon hue; the label stays ink', () => {
    for (const [chipId, token] of HUES) {
      const chip = declarations(homeHeroCss, `.home-hero__type-pill[data-chip='${chipId}']`);
      expect(chip, chipId).toMatch(new RegExp(`--type-pill-hue:\\s*var\\(${token}\\);`));
    }
    const icon = declarations(homeHeroCss, '.home-hero__type-pill > .od-icon');
    expect(icon).toMatch(/color:\s*var\(--type-pill-hue, currentColor\);/);
    // The label keeps the strong ink at rest — colour lives on the icon only.
    expect(declarations(homeHeroCss, '.home-hero__type-pill')).toMatch(
      /color:\s*var\(--text-strong\);/,
    );
  });

  it('the composer pill naming a picked lead type is a light tint of that hue, not the brand green', () => {
    // Picking a type retires the type row, so the selected state lives on the
    // composer's template pill (`TemplatePicker` stamps `data-chip`).
    const pill = (chipId: string) =>
      `.home-hero__footer-option--select.home-hero__template-option.has-selection[data-field-name='template'][data-chip='${chipId}']`;
    for (const [chipId, token] of HUES) {
      expect(declarations(homeHeroCss, pill(chipId)), chipId).toMatch(
        new RegExp(`--type-pill-hue:\\s*var\\(${token}\\);`),
      );
    }
    const active = declarations(homeHeroCss, pill('prototype'));
    expect(active).toMatch(
      /background-color:\s*color-mix\(in srgb, var\(--type-pill-hue\) 10%, transparent\);/,
    );
    expect(active).toMatch(
      /box-shadow:\s*inset 0 0 0 1px color-mix\(in srgb, var\(--type-pill-hue\) 36%, transparent\);/,
    );
    expect(active).toMatch(/color:\s*var\(--text-strong\);/);
    // One rule covers all three lead types; the icon takes the hue and the
    // label stays ink.
    const rule = rules(homeHeroCss).find(
      (item) => item.selectors.includes(pill('prototype')) && /background-color/.test(item.body),
    );
    expect(rule?.selectors).toEqual(expect.arrayContaining([pill('deck'), pill('document')]));
    expect(
      declarations(
        homeHeroCss,
        ".home-hero__template-option.has-selection[data-chip='prototype'] .home-hero__footer-option-icon",
      ),
    ).toMatch(/color:\s*var\(--type-pill-hue\);/);
    expect(
      declarations(
        homeHeroCss,
        ".home-hero__template-option.has-selection[data-chip='prototype'] .home-hero__footer-select-label",
      ),
    ).toMatch(/color:\s*var\(--text-strong\);/);
  });

  it('the hues are tokens with a value on the light root and on both dark entry points', () => {
    const light = declarations(tokensCss, ':root');
    const darkExplicit = declarations(tokensCss, '[data-theme="dark"]');
    const darkSystem = declarations(tokensCss, '@media (prefers-color-scheme: dark)');
    for (const [, token] of HUES) {
      expect(light, `${token} light`).toMatch(new RegExp(`${token}:\\s*[^;]+;`));
      expect(darkExplicit, `${token} dark`).toMatch(new RegExp(`${token}:\\s*[^;]+;`));
      expect(darkSystem, `${token} dark system`).toMatch(new RegExp(`${token}:\\s*[^;]+;`));
    }
  });
});
