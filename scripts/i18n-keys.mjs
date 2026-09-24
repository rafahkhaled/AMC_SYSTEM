/**
 * Every key a screen asks for, checked against the bundles.
 *
 * The parity test compares Arabic with English, which is a real thing to
 * check and says nothing about whether either has what the code wants. The
 * home screen shipped calling `deadlineKinds.vat_return` when no such
 * namespace existed in either language, and i18next's answer to a missing key
 * is to print the key — so the screen read "deadlineKinds.vat_return" to the
 * user and every test still passed.
 *
 * Template keys like t(`services.${code}`) are checked to their static
 * prefix: that the namespace exists at all, which is what was wrong here. The
 * leaves behind a variable cannot be known from the source.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../apps/web/src', import.meta.url).pathname;

function sources(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sources(path));
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) found.push(path);
  }
  return found;
}

/** The bundle's keys, flattened to dotted paths. */
function flatten(value, prefix = '') {
  if (value === null || typeof value !== 'object') return new Set([prefix]);
  const keys = new Set();
  for (const [name, inner] of Object.entries(value)) {
    for (const key of flatten(inner, prefix ? `${prefix}.${name}` : name)) keys.add(key);
  }
  return keys;
}

const bundleSource = readFileSync(join(ROOT, 'i18n/translations.ts'), 'utf8');
// Loading the module would drag in the whole app; the bundle is a plain
// object literal and reading it as one is enough for this.
const english = bundleSource.slice(bundleSource.indexOf('\n  en: {'));

/**
 * The bundle's keys, by following its braces.
 *
 * Indentation was the obvious way and the wrong one: it depends on whatever
 * the formatter did last, and the first attempt blew up on the very first
 * line. Braces are what the language actually uses.
 */
const keys = new Set();
{
  const path = [];
  let index = english.indexOf('{');
  let pending = null;

  for (; index < english.length; index += 1) {
    const rest = english.slice(index);
    const name = /^\s*([A-Za-z_][\w]*)\s*:/.exec(rest);
    if (name) {
      pending = name[1];
      keys.add([...path, pending].join('.'));
      index += name[0].length - 1;
      continue;
    }
    if (english[index] === '{') {
      if (pending !== null) path.push(pending);
      pending = null;
    } else if (english[index] === '}') {
      if (path.length === 0) break;
      path.pop();
      pending = null;
    } else if (english[index] === "'" || english[index] === '"') {
      // Skip the string, so an apostrophe or a brace inside a translation
      // cannot be mistaken for structure.
      const quote = english[index];
      index += 1;
      while (index < english.length && english[index] !== quote) {
        index += english[index] === '\\' ? 2 : 1;
      }
    }
  }
}

const missing = [];
for (const file of sources(ROOT)) {
  const text = readFileSync(file, 'utf8');
  const where = file.slice(ROOT.length + 1);

  for (const [, key] of text.matchAll(/\bt\(\s*'([A-Za-z][\w.]*)'/g)) {
    // A plural takes suffixed forms; the base key need not exist on its own.
    const plural = [...keys].some((known) => known.startsWith(`${key}_`));
    if (!keys.has(key) && !plural) missing.push({ where, key });
  }

  for (const [, prefix] of text.matchAll(/\bt\(\s*`([A-Za-z][\w.]*)\.\$\{/g)) {
    if (!keys.has(prefix)) missing.push({ where, key: `${prefix}.*` });
  }
}

if (missing.length > 0) {
  console.error('Keys a screen asks for that no bundle defines:\n');
  for (const { where, key } of missing) console.error(`  ${key}  —  ${where}`);
  console.error(`\n${missing.length} missing, which render as the key itself.`);
  process.exit(1);
}
console.log(`Every translation key a screen asks for exists (${keys.size} defined).`);
