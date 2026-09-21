#!/usr/bin/env node
/**
 * Does the Dockerfile still know about every workspace package?
 *
 * The dependency stage copies each `package.json` by name so that a source
 * change does not reinstall the world. That list is hand-written, and it drifted
 * six packages behind the workspace without anybody noticing: this machine has
 * no Docker, so nothing ever built the image, and the drift would first have
 * appeared as a failed deploy blaming the lockfile.
 *
 * A list that has to be maintained by hand is a list that needs a check.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Every directory that is a workspace member, from the filesystem. */
async function workspaceManifests() {
  const found = [];
  for (const group of ['apps', 'packages', 'packages/modules']) {
    let entries;
    try {
      entries = await readdir(join(ROOT, group), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // packages/modules is itself inside packages, and is not a package.
      if (group === 'packages' && entry.name === 'modules') continue;
      const manifest = `${group}/${entry.name}/package.json`;
      try {
        await readFile(join(ROOT, manifest), 'utf8');
        found.push(manifest);
      } catch {
        // A directory with no manifest is not a workspace member.
      }
    }
  }
  return found.sort();
}

const dockerfile = await readFile(join(ROOT, 'Dockerfile'), 'utf8');
const copied = new Set(
  [...dockerfile.matchAll(/^COPY\s+(\S+\/package\.json)\s/gm)].map((match) => match[1]),
);

const expected = await workspaceManifests();
const missing = expected.filter((manifest) => !copied.has(manifest));
const stale = [...copied].filter((manifest) => !expected.includes(manifest)).sort();

if (missing.length === 0 && stale.length === 0) {
  console.log(`Dockerfile copies all ${expected.length} workspace manifests.`);
  process.exit(0);
}

console.error('The Dockerfile and the workspace disagree.\n');
if (missing.length > 0) {
  console.error('  In the workspace, not copied by the Dockerfile:');
  for (const manifest of missing)
    console.error(`    COPY ${manifest} ${manifest.replace('package.json', '')}`);
  console.error('\n  Without these, pnpm install --frozen-lockfile fails in the image.');
}
if (stale.length > 0) {
  console.error('\n  Copied by the Dockerfile, no longer in the workspace:');
  for (const manifest of stale) console.error(`    ${manifest}`);
}
process.exit(1);
