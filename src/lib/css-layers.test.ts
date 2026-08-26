/**
 * Element-level styling in globals.css must live inside `@layer base`.
 *
 * ── The bug this exists to prevent ───────────────────────────────────────────
 * Tailwind v4 puts its utilities in `@layer utilities`. CSS cascade layers beat
 * specificity outright: any rule written OUTSIDE a layer wins over every rule
 * inside one, no matter how specific the layered selector is. So an unlayered
 * `a { color: var(--blue) }` silently overrides `text-surface` on every anchor
 * in the codebase.
 *
 * That shipped. The confirmation screen's primary call to action is a `<Link>`
 * styled as a solid blue button, and its label rendered blue-on-blue — an
 * invisible label on the one control the page exists to offer, and a contrast
 * failure besides. Nothing caught it: it typechecks, it lints, it renders in
 * jsdom (which does not do layers), and the class list reads correctly in review.
 * Only a human looking at the running page could see it, and the sibling
 * `<button>` next to it looked fine, because no unlayered rule sets a colour on
 * `<button>`.
 *
 * The class of bug is bigger than that one anchor: the same trap is waiting for
 * anyone who puts a `text-*` or `font-*` utility on an `<h2>`, or a `bg-*` on
 * `<body>`. So the guard is on the shape, not on the instance.
 *
 * ── Why a test and not a code-review note ────────────────────────────────────
 * "Remember that unlayered CSS beats utilities" is precisely the kind of thing
 * that is remembered right up until the day someone adds a two-line element
 * default at the bottom of globals.css. The rule is mechanical, so it is checked
 * mechanically.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const GLOBALS_CSS = path.join(process.cwd(), 'src/app/globals.css');

/**
 * Unlayered element rules that are deliberate, each with the reason it has to
 * outrank utilities. Adding an entry here is a decision, which is the point —
 * the test is not asking to be silenced, it is asking to be argued with.
 */
const ALLOWED_UNLAYERED: readonly { selector: string; because: string }[] = [
  {
    selector: 'input,select,textarea',
    because:
      'iOS Safari zooms in on focus for any input under 16px and stays zoomed. ' +
      'This one has to beat a stray text-sm utility, so being unlayered is the ' +
      'whole mechanism rather than an oversight.',
  },
  {
    selector: 'html[lang="he"]',
    because:
      'Defines custom properties (the Hebrew font stack) rather than styling the ' +
      'element. Nothing in Tailwind competes for a --font-* variable, and it pairs ' +
      'with the :root token block directly above it.',
  },
];

/** Strip /* … *\/ comments so a selector-looking string inside one cannot match. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Selector preludes of every rule at the top level of the file — that is, every
 * rule NOT nested inside an at-rule such as `@layer` or `@media`. At-rule
 * preludes themselves are returned too, so the caller can tell them apart by
 * their leading `@` and skip their contents.
 */
function topLevelPreludes(css: string): string[] {
  const preludes: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of css) {
    if (char === '{') {
      if (depth === 0) preludes.push(current.trim());
      depth += 1;
      current = '';
    } else if (char === '}') {
      depth -= 1;
      current = '';
    } else if (depth === 0) {
      current += char;
    }
  }

  return preludes;
}

/**
 * True when a selector list targets a bare HTML element — `a`, `h1, h2`,
 * `a:hover`, `input, select, textarea`. Class, id, attribute-only, universal and
 * pseudo-class-only selectors (`.card`, `#app`, `*`, `:focus-visible`) are not
 * element defaults and are none of this test's business.
 */
function targetsBareElement(selectorList: string): boolean {
  return selectorList
    .split(',')
    .some((selector) => /^[a-z][a-z0-9]*(?![\w-])/.test(selector.trim()));
}

function normalise(selectorList: string): string {
  return selectorList
    .split(',')
    .map((part) => part.trim())
    .join(',');
}

describe('globals.css cascade layers', () => {
  const css = stripComments(readFileSync(GLOBALS_CSS, 'utf8'));

  it('keeps every element-level default inside a layer', () => {
    const allowed = new Set(ALLOWED_UNLAYERED.map((entry) => entry.selector));

    const offenders = topLevelPreludes(css)
      .filter((prelude) => !prelude.startsWith('@'))
      .filter(targetsBareElement)
      .map(normalise)
      .filter((selector) => !allowed.has(selector));

    expect(
      offenders,
      'These rules style bare HTML elements from outside any @layer, so they beat ' +
        'every Tailwind utility regardless of specificity. Move them into ' +
        '`@layer base`, or add them to ALLOWED_UNLAYERED with the reason they must ' +
        'outrank utilities.',
    ).toEqual([]);
  });

  /**
   * Guards the guard. If the file ever stops containing `@layer base` — a
   * refactor, a rewrite, a merge that drops it — the check above would pass
   * vacuously, having found nothing to complain about.
   */
  it('actually has a base layer to put them in', () => {
    expect(css).toMatch(/@layer\s+base\s*\{/);
  });

  /**
   * The anchor colour is the specific rule that shipped the bug, so it is worth
   * naming rather than trusting the general check to keep covering it.
   */
  it('layers the anchor colour that made a primary button invisible', () => {
    const baseLayer = css.slice(css.indexOf('@layer base'));
    expect(baseLayer).toMatch(/\ba\s*\{[^}]*color:/);
  });
});
