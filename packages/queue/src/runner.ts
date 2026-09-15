import type { Clock } from '@amc/kernel';
import { type Job, type JobHandler, PermanentJobFailure } from './job.js';
import type { PostgresJobQueue } from './queue.js';

export interface RunnerOptions {
  readonly worker: string;
  readonly batchSize: number;
  readonly leaseSeconds: number;
  /** How long to wait when there was nothing to do. */
  readonly idleMilliseconds: number;
  readonly onEvent?: (event: RunnerEvent) => void;
}

export type RunnerEvent =
  | { type: 'started'; job: Job }
  | { type: 'completed'; job: Job; durationMs: number }
  | { type: 'retrying'; job: Job; error: string }
  | { type: 'failed'; job: Job; error: string }
  | { type: 'unhandled'; job: Job }
  | { type: 'error'; error: unknown };

/**
 * The loop: claim a few jobs, run them, record what happened, repeat.
 *
 * One job failing never stops the batch, which is NFR-02 written as code: a
 * single unreadable invoice must not take the other hundred and ninety-nine
 * down with it.
 */
export class JobRunner {
  private readonly handlers = new Map<string, JobHandler>();
  private running = false;
  private stopped?: () => void;

  constructor(
    private readonly queue: PostgresJobQueue,
    private readonly clock: Clock,
    private readonly options: RunnerOptions,
  ) {}

  register<TPayload extends Record<string, unknown>>(
    name: string,
    handler: JobHandler<TPayload>,
  ): this {
    this.handlers.set(name, handler as JobHandler);
    return this;
  }

  get registered(): string[] {
    return [...this.handlers.keys()];
  }

  /** Runs one batch. Returns how many jobs were attempted. */
  async runOnce(): Promise<number> {
    const jobs = await this.queue.claim({
      worker: this.options.worker,
      limit: this.options.batchSize,
      leaseSeconds: this.options.leaseSeconds,
    });

    for (const job of jobs) {
      await this.runOne(job);
    }
    return jobs.length;
  }

  private async runOne(job: Job): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      // Not retried: an unknown name will still be unknown in five minutes,
      // and a job quietly looping for ever is worse than one plainly stopped.
      await this.queue.fail(job, `No handler registered for "${job.name}"`, true);
      this.options.onEvent?.({ type: 'unhandled', job });
      return;
    }

    const startedAt = this.clock.now().getTime();
    this.options.onEvent?.({ type: 'started', job });

    try {
      await handler(job);
      await this.queue.complete(job.id);
      this.options.onEvent?.({
        type: 'completed',
        job,
        durationMs: this.clock.now().getTime() - startedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const permanent = error instanceof PermanentJobFailure;
      const outcome = await this.queue.fail(job, message, permanent);
      this.options.onEvent?.({
        type: outcome === 'failed' ? 'failed' : 'retrying',
        job,
        error: message,
      });
    }
  }

  /** Runs until stop() is called. */
  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      try {
        await this.queue.releaseExpiredClaims();
        const attempted = await this.runOnce();
        if (attempted === 0) await this.pause(this.options.idleMilliseconds);
      } catch (error) {
        // The loop itself must survive a database hiccup, or one blip ends
        // background processing until somebody notices.
        this.options.onEvent?.({ type: 'error', error });
        await this.pause(this.options.idleMilliseconds);
      }
    }
    this.stopped?.();
  }

  /** Stops after the batch in flight finishes, so no job is abandoned midway. */
  async stop(): Promise<void> {
    if (!this.running) return;
    const finished = new Promise<void>((resolve) => {
      this.stopped = resolve;
    });
    this.running = false;
    await finished;
  }

  private pause(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
