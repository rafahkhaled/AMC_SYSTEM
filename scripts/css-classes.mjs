/**
 * Every class the components use, against every class the stylesheets define.
 *
 * A rename that covers .tsx and misses .css is silent: the component renders,
 * the class is simply unknown, and the element loses its rules without any
 * error anywhere. That is how the projects board ended up with no layout and
 * "Marina Contracting LLCVAT return" run together as one word.
 *
 * Reports what components use and no stylesheet defines. The other direction
 * is not an error — a stylesheet may carry a class for markup not yet written
 * — so it is not reported at all.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../apps/web/src', import.meta.url).pathname;

function walk(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else found.push(path);
  }
  return found;
}

/**
 * The class names in a `className=` value.
 *
 * A scanner rather than a regular expression, because the value is code:
 * `` `tab${active ? ' tab--active' : ''}` `` holds two class names and one
 * expression, and the expression's identifiers are not classes. Reading the
 * quoted strings and the static parts of template literals — and nothing that
 * sits inside `${…}` unless it is itself quoted — is the difference between
 * checking the classes and checking every variable in the file.
 *
 * Static text and code strings are kept apart because they are trusted
 * differently. A template's static parts are class names by construction; a
 * quoted string in code may be a class (`active ? 'tab--active' : ''`) or an
 * ordinary comparison (`tone === 'primary'`), and nothing here can tell which.
 *
 * biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a lexer is one
 * state machine and reads as one. Split into a function per state, the stack
 * has to be threaded through each of them, and the first attempt at that
 * dropped the pop on leaving a string — so the scanner ran past the attribute
 * and reported every word of every comment in the file as a missing class.
 */
function classTextIn(source, start) {
  const staticText = [];
  const codeText = [];
  let fromCode = false;
  let index = start;
  let depth = 0;
  // A stack, because a template literal can hold an expression that holds
  // another template literal.
  const stack = [];
  let current = null;

  while (index < source.length) {
    const character = source[index];

    if (current === "'" || current === '"') {
      if (character === '\\') index += 1;
      else if (character === current) {
        current = stack.pop() ?? null;
        fromCode = current === null;
      } else (fromCode ? codeText : staticText).push(character);
      index += 1;
      continue;
    }

    if (current === '`') {
      if (character === '\\') index += 1;
      else if (character === '`') current = stack.pop() ?? null;
      else if (character === '$' && source[index + 1] === '{') {
        stack.push(current);
        current = null;
        depth += 1;
        index += 1;
      } else staticText.push(character);
      index += 1;
      continue;
    }

    // In code: quoted strings still count, bare identifiers do not.
    if (character === "'" || character === '"' || character === '`') {
      stack.push(current);
      fromCode = character !== '`';
      current = character;
      codeText.push(' ');
      staticText.push(' ');
    } else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth <= 0) break;
      current = stack.pop() ?? null;
    }
    index += 1;
  }

  return { staticText: staticText.join(''), codeText: codeText.join('') };
}

const files = walk(ROOT);

/*
 * `[\w-]+` rather than a \b-delimited word: \b does not match before an
 * underscore, so `.card__title` read as `.card` and three BEM children went
 * unchecked the first time this was done by hand.
 */
const defined = new Set();
for (const file of files.filter((name) => name.endsWith('.css'))) {
  const css = readFileSync(file, 'utf8');
  for (const [, name] of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(name);
}

const used = new Map();
for (const file of files.filter((name) => /\.tsx?$/.test(name))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/className=/g)) {
    const at = match.index + match[0].length;
    const quote = source[at];
    const { staticText, codeText } =
      quote === '"' || quote === "'"
        ? { staticText: source.slice(at + 1, source.indexOf(quote, at + 1)), codeText: '' }
        : classTextIn(source, at);

    for (const name of staticText.split(/\s+/).filter(Boolean)) {
      if (/^[_a-zA-Z][\w-]*$/.test(name) && !used.has(name)) used.set(name, file);
    }
    // A bare word out of code is far more likely to be a prop value than a
    // class, so only the ones shaped like this project's classes are kept.
    for (const name of codeText.split(/\s+/).filter(Boolean)) {
      if (/^[_a-zA-Z][\w-]*[-_][\w-]*$/.test(name) && !used.has(name)) used.set(name, file);
    }
  }
}

/**
 * A class with no rules of its own is not necessarily a mistake.
 *
 * `.lead-card` carries nothing and exists so `.lead-card__convert` has a
 * parent to hang from, and `` `alert alert--${tone}` `` leaves the prefix
 * `alert--` behind when the interpolation is cut out. Both are satisfied by a
 * defined class that continues them. A rename is not: nothing defined begins
 * with the new block's name, which is exactly how `.task-card` was caught.
 */
function known(name) {
  if (defined.has(name)) return true;
  for (const candidate of defined) {
    if (candidate.startsWith(name) && /^[-_]/.test(candidate.slice(name.length))) return true;
    if (name.endsWith('-') || name.endsWith('_')) {
      if (candidate.startsWith(name)) return true;
    }
  }
  return false;
}

const missing = [...used].filter(([name]) => !known(name));

if (missing.length > 0) {
  console.error('Classes used by a component that no stylesheet defines:\n');
  for (const [name, file] of missing.sort()) {
    console.error(`  .${name}  —  ${file.slice(ROOT.length + 1)}`);
  }
  console.error(`\n${missing.length} undefined, which render with no rules at all.`);
  process.exit(1);
}

console.log(`Every class used is defined (${used.size} used, ${defined.size} defined).`);
