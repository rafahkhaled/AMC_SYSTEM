import { z } from 'zod';

/**
 * Configuration is validated once, at boot, and the process refuses to start
 * when something is missing or malformed. A server that starts with a broken
 * configuration and fails on the first real request is worse than one that
 * never starts, because the failure arrives while someone is using it.
 */
const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: booleanish.default('false'),

  // Sessions. Both limits exist on purpose: idle covers the unattended laptop,
  // absolute covers the session that is kept alive by activity alone (NFR-04).
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),

  // Business rules. Stored times are UTC; rules are expressed in Dubai time.
  BUSINESS_TIME_ZONE: z.string().default('Asia/Dubai'),
  DEFAULT_CURRENCY: z.enum(['AED', 'USD', 'EUR', 'GBP', 'SAR']).default('AED'),
});

export type Environment = z.infer<typeof environmentSchema>;

export class ConfigurationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Configuration is not usable:\n  ${issues.join('\n  ')}`);
    this.name = 'ConfigurationError';
  }
}

export function readEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const parsed = environmentSchema.safeParse(source);
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues.map(
    (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  throw new ConfigurationError(issues);
}

export const ENVIRONMENT = Symbol('ENVIRONMENT');
