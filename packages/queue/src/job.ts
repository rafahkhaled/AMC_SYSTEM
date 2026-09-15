/** What a caller asks for when putting work on the queue. */
export interface JobRequest {
  readonly name: string;
  readonly payload?: Record<string, unknown>;
  /** When it becomes eligible. Omitted means now. */
  readonly runAt?: Date;
  readonly priority?: number;
  readonly maxAttempts?: number;
  /**
   * Natural key for work that must happen once per thing per period. Enqueuing
   * the same key twice while the first is still live is a no-op, which is what
   * lets a scheduler be replayed safely after an outage.
   */
  readonly uniqueKey?: string;
}

/** A job handed to a handler. */
export interface Job<TPayload = Record<string, unknown>> {
  readonly id: string;
  readonly name: string;
  readonly payload: TPayload;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly runAt: Date;
}

export type JobHandler<TPayload = Record<string, unknown>> = (job: Job<TPayload>) => Promise<void>;

/**
 * How long to wait before trying again, growing quickly and then stopping.
 *
 * The first retry is almost immediate, because most failures are a moment's
 * unavailability. Later ones back off so that a genuinely broken dependency is
 * not hammered, and the ceiling keeps a job from drifting hours into the
 * future where nobody would notice it.
 */
export function backoffSeconds(attempts: number): number {
  // Clamped before the exponent so the doubling cannot overflow, then capped.
  return Math.min(2 ** Math.min(attempts, 16), 300);
}

/**
 * A failure worth telling the operator about immediately rather than retrying.
 * Throwing this from a handler stops the job at once: a malformed payload will
 * not become well formed on the fourth attempt.
 */
export class PermanentJobFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobFailure';
  }
}
