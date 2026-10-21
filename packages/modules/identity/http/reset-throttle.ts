import { Injectable } from '@nestjs/common';

/**
 * A ceiling on password-reset requests.
 *
 * Each request sends an email to a real person, so without a limit this is a
 * way to fill somebody's inbox, or to run up the mail bill. Three an hour for
 * one address stops that without getting in the way of somebody who mistyped;
 * ten an hour from one place stops a script working down a list of addresses.
 * Held in memory, correct for the single instance this runs as.
 */
const HOUR = 3_600_000;
const PER_EMAIL = 3;
const PER_ADDRESS = 10;

@Injectable()
export class ResetThrottle {
  private readonly seen = new Map<string, { count: number; startedAt: number }>();

  /** True when the request may go ahead. */
  allow(address: string, email: string, now: number = Date.now()): boolean {
    this.forgetStale(now);
    const byAddress = this.hit(`ip:${address}`, now) <= PER_ADDRESS;
    const byEmail = this.hit(`email:${email.trim().toLowerCase()}`, now) <= PER_EMAIL;
    return byAddress && byEmail;
  }

  private hit(key: string, now: number): number {
    const record = this.seen.get(key);
    if (!record || now - record.startedAt >= HOUR) {
      this.seen.set(key, { count: 1, startedAt: now });
      return 1;
    }
    record.count += 1;
    return record.count;
  }

  private forgetStale(now: number): void {
    for (const [key, record] of this.seen) {
      if (now - record.startedAt >= HOUR) this.seen.delete(key);
    }
  }
}
