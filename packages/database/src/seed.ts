import type postgres from 'postgres';
import type { Database } from './client.js';

/**
 * A seed is reference data the system cannot run without: the eleven service
 * templates, the role definitions, the UAE holiday calendar. It is not sample
 * data, and it runs in production as well as locally, so every seed must be
 * safe to run twice.
 */
export interface Seed {
  readonly name: string;
  run(context: { db: Database; sql: postgres.Sql }): Promise<void>;
}

const seeds: Seed[] = [];

export function registerSeed(seed: Seed): void {
  seeds.push(seed);
}

export async function runSeeds(
  context: { db: Database; sql: postgres.Sql },
  log: (message: string) => void = () => {},
): Promise<string[]> {
  const executed: string[] = [];
  for (const seed of seeds) {
    log(`seeding ${seed.name}`);
    await seed.run(context);
    executed.push(seed.name);
  }
  return executed;
}
