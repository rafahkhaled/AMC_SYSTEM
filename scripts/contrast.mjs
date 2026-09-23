/**
 * Every colour pair the interface actually puts together, measured.
 *
 * WCAG AA wants 4.5:1 for body text and 3:1 for large text and for the edges
 * of a control. Judging that by eye is how `--text-faint` shipped at 2.56:1
 * and made every date on the projects board unreadable — it looked fine to
 * somebody who already knew what it said.
 *
 * The pairs are listed rather than derived: which colour lands on which
 * surface is a fact about the screens, and a stylesheet parser that guessed
 * would be confidently wrong.
 */
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../apps/web/src/design/tokens.css', import.meta.url), 'utf8');

/**
 * The declarations inside one rule, found by matching its braces.
 *
 * Sliced on a marker string before, which broke silently the moment the dark
 * palette stopped being a media query: `indexOf` returned -1, `slice(-1)`
 * handed back one character, and the run measured the same palette twice and
 * reported it as both. Every pair passed, for the wrong reason. Anything that
 * cannot find what it is looking for has to say so.
 */
function block(source, selector) {
  // A pattern, not a literal: the formatter is entitled to its own quote
  // style, and a check that breaks when it changes one is a check that will
  // be deleted rather than fixed.
  const found = selector.exec(source);
  if (!found) throw new Error(`${selector} matches nothing in tokens.css`);
  const start = found.index;

  let depth = 0;
  let index = source.indexOf('{', start);
  const from = index;
  for (; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}' && --depth === 0) break;
  }

  const values = new Map();
  for (const [, name, value] of source.slice(from, index).matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    values.set(name, value.trim());
  }
  if (values.size === 0) throw new Error(`${selector} declares no tokens`);
  return values;
}

const scales = block(CSS, /^:root\s*\{/m);
const darkOverrides = block(CSS, /^:root\[data-theme=["']dark["']\]\s*\{/m);

/** Follows `var(--x)` until it reaches a literal colour. */
function resolve(name, overrides) {
  const seen = new Set();
  let value = overrides.get(name) ?? scales.get(name);
  while (value?.startsWith('var(')) {
    const next = value.slice(4, -1).trim().replace(/^--/, '');
    if (seen.has(next)) return null;
    seen.add(next);
    value = overrides.get(next) ?? scales.get(next);
  }
  return value ?? null;
}

function channel(hex) {
  const value = Number.parseInt(hex, 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(colour) {
  const hex = colour.replace('#', '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const r = channel(full.slice(0, 2));
  const g = channel(full.slice(2, 4));
  const b = channel(full.slice(4, 6));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(front, back) {
  const a = luminance(front);
  const b = luminance(back);
  const [light_, dark_] = a > b ? [a, b] : [b, a];
  return (light_ + 0.05) / (dark_ + 0.05);
}

/**
 * front, back, the smallest ratio that will do, and what it is for.
 *
 * 4.5 for anything read as prose, 3 for large text and for a control's own
 * edge — a border at 4.5 would be a box drawn in ink.
 */
const PAIRS = [
  ['text', 'surface', 4.5, 'body text on a card'],
  ['text', 'surface-sunken', 4.5, 'body text on the page behind the cards'],
  ['text', 'surface-raised', 4.5, 'body text on a raised row'],
  ['text-soft', 'surface', 4.5, 'a hint under a field'],
  ['text-soft', 'surface-sunken', 4.5, 'a hint on the page'],
  ['text-faint', 'surface', 4.5, 'a date, a period key, an assignee'],
  ['text-faint', 'surface-sunken', 4.5, 'the same, on the page'],
  ['text-faint', 'surface-raised', 4.5, 'the same, on a raised row'],
  ['accent', 'surface', 4.5, 'a link, the active tab'],
  ['accent', 'surface-sunken', 4.5, 'a link on the page'],
  ['text-on-brand', 'accent', 4.5, 'the label inside a primary button'],
  ['danger', 'surface', 4.5, 'an overdue figure'],
  ['danger', 'danger-soft', 4.5, 'an error alert'],
  ['warning', 'surface', 4.5, 'an unbilled figure'],
  ['warning', 'warning-soft', 4.5, 'a warning alert, a badge'],
  ['success', 'surface', 4.5, 'a paid figure'],
  ['success', 'success-soft', 4.5, 'a success alert, a badge'],
  ['control-line', 'surface', 3, 'the edge of an input or a secondary button'],
  ['control-line', 'surface-sunken', 3, 'the same, on the page'],
  ['control-line', 'surface-raised', 3, 'the same, on a raised row'],
];

let failures = 0;
for (const [theme, overrides] of [
  ['light', new Map()],
  ['dark', darkOverrides],
]) {
  console.log(`\n${theme}`);
  for (const [front, back, needs, what] of PAIRS) {
    const a = resolve(front, overrides);
    const b = resolve(back, overrides);
    if (!a || !b || !a.startsWith('#') || !b.startsWith('#')) {
      console.log(`  skip  --${front} on --${back} (not a plain colour)`);
      continue;
    }
    const measured = ratio(a, b);
    const ok = measured >= needs;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? 'pass' : 'FAIL'}  ${measured.toFixed(2)}:1 (needs ${needs}) ` +
        `--${front} on --${back} — ${what}`,
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} pair(s) below the contrast they need.`);
  process.exit(1);
}
console.log('\nEvery pair meets the contrast it needs.');
