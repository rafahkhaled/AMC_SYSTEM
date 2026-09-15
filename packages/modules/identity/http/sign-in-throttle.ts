import { Injectable } from '@nestjs/common';

/**
 * A ceiling on sign-in attempts from one address.
 *
 * The per-account lockout stops someone working through passwords for a known
 * person. This stops the other shape of the same attack: one password tried
 * against many accounts, which no per-account counter would ever notice.
 *
 * Held in memory, which is correct for the single instance this system runs on
 * (ADR-0005). If it ever runs as more than one process, this moves to Redis,
 * and the interface stays the same.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 30;

@Injectable()
export class SignInThrottle {
  private readonly attempts = new Map<string, { count: number; windowStartedAt: number }>();

  /** True when the attempt may proceed. */
  allow(key: string, now: number = Date.now()): boolean {
    const record = this.attempts.get(key);

    if (!record || now - record.windowStartedAt >= WINDOW_MS) {
      this.attempts.set(key, { count: 1, windowStartedAt: now });
      this.forgetStaleEntries(now);
      return true;
    }

    record.count += 1;
    return record.count <= MAX_ATTEMPTS_PER_WINDOW;
  }

  /** A successful sign-in clears the count, so honest users are never punished. */
  clear(key: string): void {
    this.attempts.delete(key);
  }

  private forgetStaleEntries(now: number): void {
    for (const [key, record] of this.attempts) {
      if (now - record.windowStartedAt >= WINDOW_MS) this.attempts.delete(key);
    }
  }
}
