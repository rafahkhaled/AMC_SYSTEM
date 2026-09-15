import { DrizzleOutboxReader } from '@amc/audit/infrastructure';
import { createDatabase } from '@amc/database';
import { SystemClock } from '@amc/kernel';
import { JobRunner, PostgresJobQueue } from '@amc/queue';
import pino from 'pino';
import { ulid } from 'ulid';
import { readWorkerEnvironment } from './config.js';
import { registerEventSubscribers, registerJobHandlers } from './handlers.js';
import { OutboxPublisher } from './outbox-publisher.js';

/**
 * The background process.
 *
 * It shares the API's database and nothing else, because the queue is a table
 * (ADR-0006). That means this process can be stopped, restarted or scaled
 * without anything being lost: work in flight returns to the queue when its
 * lease lapses, and work not yet started was never anywhere else.
 */
async function bootstrap(): Promise<void> {
  const environment = readWorkerEnvironment();
  const logger = pino({
    level: environment.LOG_LEVEL,
    base: { service: 'amc-worker', env: environment.NODE_ENV, worker: environment.WORKER_NAME },
  });

  const { db, close } = createDatabase({
    url: environment.DATABASE_URL,
    maxConnections: 5,
    // Longer than the API's, because extraction jobs are slow by nature.
    statementTimeoutSeconds: 120,
  });

  const clock = new SystemClock();
  const queue = new PostgresJobQueue(db, { next: () => ulid() }, clock);

  const runner = registerJobHandlers(
    new JobRunner(queue, clock, {
      worker: environment.WORKER_NAME,
      batchSize: environment.WORKER_BATCH_SIZE,
      leaseSeconds: environment.WORKER_LEASE_SECONDS,
      idleMilliseconds: environment.WORKER_IDLE_MILLISECONDS,
      onEvent: (event) => {
        switch (event.type) {
          case 'completed':
            logger.info(
              { job: event.job.name, id: event.job.id, ms: event.durationMs },
              'job done',
            );
            break;
          case 'retrying':
            logger.warn(
              {
                job: event.job.name,
                id: event.job.id,
                attempt: event.job.attempts,
                err: event.error,
              },
              'job failed, will try again',
            );
            break;
          case 'failed':
            logger.error(
              { job: event.job.name, id: event.job.id, err: event.error },
              'job gave up',
            );
            break;
          case 'unhandled':
            logger.error({ job: event.job.name }, 'no handler for this job');
            break;
          case 'error':
            logger.error({ err: event.error }, 'the runner itself failed');
            break;
          default:
            break;
        }
      },
    }),
  );

  const publisher = registerEventSubscribers(
    new OutboxPublisher(
      new DrizzleOutboxReader(db),
      clock,
      environment.OUTBOX_BATCH_SIZE,
      (message, detail) => logger.warn(detail, message),
    ),
  );

  let draining = true;
  const drainOutbox = async (): Promise<void> => {
    while (draining) {
      try {
        const delivered = await publisher.drain();
        if (delivered === 0) await sleep(environment.WORKER_IDLE_MILLISECONDS);
      } catch (error) {
        logger.error({ err: error }, 'outbox drain failed');
        await sleep(environment.WORKER_IDLE_MILLISECONDS);
      }
    }
  };

  logger.info(
    { jobs: runner.registered.length, batchSize: environment.WORKER_BATCH_SIZE },
    'worker started',
  );

  const loops = Promise.all([runner.start(), drainOutbox()]);

  /**
   * Stop cleanly. The runner finishes the batch it is holding rather than
   * abandoning it mid-job, which is what keeps a deploy from leaving a
   * half-processed invoice batch behind.
   */
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'stopping, finishing the batch in flight');
    draining = false;
    await runner.stop();
    await loops;
    await close();
    logger.info('stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await loops;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `Worker failed to start: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
