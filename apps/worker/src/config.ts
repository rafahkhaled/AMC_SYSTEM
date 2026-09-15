import { z } from 'zod';

export const workerEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().default('postgres://amc@127.0.0.1:5433/amc'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Identifies this process in the jobs table, so a claim can be traced. */
  WORKER_NAME: z.string().default(`worker-${process.pid}`),
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().max(100).default(10),
  /**
   * A claim must outlast the slowest job by a margin, or a job still running
   * is handed to a second worker. Invoice extraction is the slow one.
   */
  WORKER_LEASE_SECONDS: z.coerce.number().int().positive().default(300),
  WORKER_IDLE_MILLISECONDS: z.coerce.number().int().positive().default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(500).default(50),

  BUSINESS_TIME_ZONE: z.string().default('Asia/Dubai'),
});

export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

export function readWorkerEnvironment(source: NodeJS.ProcessEnv = process.env): WorkerEnvironment {
  const parsed = workerEnvironmentSchema.safeParse(source);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Worker configuration is not usable:\n  ${issues.join('\n  ')}`);
}
