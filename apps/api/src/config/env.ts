import { definedOnly } from '@amc/kernel';
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

  // Database. Required: a server that starts without one only fails later,
  // in front of a user.
  DATABASE_URL: z.string().url().default('postgres://amc@127.0.0.1:5433/amc'),

  // Sessions. Both limits exist on purpose: idle covers the unattended laptop,
  // absolute covers the session that is kept alive by activity alone (NFR-04).
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),

  /**
   * Seals two-factor secrets at rest, and in P0-14 the EmaraTax vault. 32
   * bytes, base64: `openssl rand -base64 32`. Required in production, where
   * booting without one would silently store secrets under a key everybody
   * knows. Outside production a fixed development key is used instead, and
   * the difference is deliberate: it must be impossible to ship by accident.
   */
  SECRET_ENCRYPTION_KEY: z.string().optional(),

  /**
   * Where client documents live.
   *
   * `local` is a folder on disk and exists so the storage path is exercised
   * for real in development rather than mocked: the same keys, the same
   * checksums, the same signed links. Production uses `s3`, in me-central-1,
   * because the data is a UAE firm's client records.
   */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_ROOT: z.string().default('.data/storage'),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_REGION: z.string().default('me-central-1'),

  /**
   * How the firm signs its own letters.
   *
   * Configuration rather than a client fact, and defaulted so a fresh install
   * produces readable letters rather than blanks that somebody signs without
   * noticing.
   */
  FIRM_NAME: z.string().default('Active Management Consultancy'),
  FIRM_SIGNATORY: z.string().default('Wael Ajam'),

  /**
   * WhatsApp, through Meta's Cloud API.
   *
   * All optional, and the driver defaults to `log`, because the business
   * account takes weeks to approve and nothing else should wait for it. The
   * logging driver exercises the whole path — a message is composed, stored,
   * queued, given an id and marked sent — so what is left untested when the
   * real credentials arrive is one HTTP call, and not the bot.
   *
   * WHATSAPP_APP_SECRET signs the webhook; without it every delivery is
   * refused, which is the correct behaviour for a `cloud` driver that has not
   * been given one. WHATSAPP_VERIFY_TOKEN is the string Meta echoes during the
   * subscription handshake and is chosen by us, not issued.
   */
  WHATSAPP_DRIVER: z.enum(['log', 'cloud']).default('log'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  FIRM_NAME_ARABIC: z.string().default('الإدارة النشطة للاستشارات'),

  /**
   * Billing.
   *
   * VAT in basis points: 500 is the UAE's five percent.
   *
   * Zero by default, because the firm's own invoice template carries no VAT
   * line — it totals the work and stops. A number rather than a flag because
   * the rate that applied when an invoice was issued is the rate that stays
   * on it, so registering later is one setting and not a rebuild, and old
   * invoices keep what they were issued at.
   *
   * The default hourly rate is what a client with no rate of their own is
   * billed at. Clients almost always have one; this is the floor under the
   * arithmetic so a missing rate bills at something visible rather than zero.
   */
  BILLING_VAT_BASIS_POINTS: z.coerce.number().int().min(0).max(10_000).default(0),
  BILLING_PAYMENT_TERMS_DAYS: z.coerce.number().int().positive().max(365).default(30),
  BILLING_DEFAULT_RATE_MINOR: z.coerce.number().int().nonnegative().default(30_000),

  // Business rules. Stored times are UTC; rules are expressed in Dubai time.
  BUSINESS_TIME_ZONE: z.string().default('Asia/Dubai'),
  DEFAULT_CURRENCY: z.enum(['AED', 'USD', 'EUR', 'GBP', 'SAR']).default('AED'),
});

const DEVELOPMENT_KEY = Buffer.alloc(32, 'amc-development-key').toString('base64');

const validatedSchema = environmentSchema.superRefine((environment, context) => {
  /*
   * A `cloud` driver with nothing to authenticate with.
   *
   * Refused at boot rather than at the first message. The failure mode
   * otherwise is silent in the worst way: the practice believes WhatsApp is
   * live, clients write in, and every reply fails somewhere nobody is looking.
   */
  if (environment.WHATSAPP_DRIVER === 'cloud') {
    for (const key of [
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_APP_SECRET',
      'WHATSAPP_VERIFY_TOKEN',
    ] as const) {
      if (!environment[key]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'is required when WHATSAPP_DRIVER is cloud',
        });
      }
    }
  }

  if (environment.NODE_ENV === 'production' && !environment.SECRET_ENCRYPTION_KEY) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SECRET_ENCRYPTION_KEY'],
      message: 'is required in production. Generate one with: openssl rand -base64 32',
    });
  }
  // A folder on the application server is not where a firm's client records
  // belong, and the failure would be silent: uploads would work, and the
  // documents would vanish with the next deployment.
  if (environment.NODE_ENV === 'production' && environment.STORAGE_DRIVER !== 's3') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['STORAGE_DRIVER'],
      message: 'must be s3 in production. Local storage does not survive a deployment.',
    });
  }
  if (environment.STORAGE_DRIVER === 's3' && !environment.STORAGE_BUCKET) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['STORAGE_BUCKET'],
      message: 'is required when the storage driver is s3',
    });
  }
});

export type Environment = z.infer<typeof environmentSchema>;

/** The key actually used, with the development fallback made explicit. */
export function encryptionKey(environment: Environment): string {
  return environment.SECRET_ENCRYPTION_KEY ?? DEVELOPMENT_KEY;
}

export class ConfigurationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Configuration is not usable:\n  ${issues.join('\n  ')}`);
    this.name = 'ConfigurationError';
  }
}

export function readEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  // Empty is absent. See definedOnly: compose writes `FOO: ${FOO:-}` for
  // everything optional, and an empty string defeats both .optional() and
  // .default().
  const parsed = validatedSchema.safeParse(definedOnly(source));
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues.map(
    (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  throw new ConfigurationError(issues);
}

export const ENVIRONMENT = Symbol('ENVIRONMENT');
