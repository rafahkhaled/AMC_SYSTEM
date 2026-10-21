import { Injectable } from '@nestjs/common';

/**
 * A ceiling on website enquiries from one address.
 *
 * The form is open to anyone, so the cost of being wrong is somebody's inbox
 * and a leads board full of rubbish. A real visitor sends one, perhaps two if
 * the first had a typo; five in ten minutes from one address is already a
 * script. Held in memory, correct for the single instance this runs as.
 */
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 5;
/** Across every address, so many addresses cannot add up to a flood. */
const MAX_EVERYWHERE_PER_HOUR = 200;

@Injectable()
export class EnquiryThrottle {
  private readonly byAddress = new Map<string, { count: number; startedAt: number }>();
  private everywhere = { count: 0, startedAt: 0 };

  /** True when the enquiry may proceed. */
  allow(address: string, now: number = Date.now()): boolean {
    if (now - this.everywhere.startedAt >= 3_600_000)
      this.everywhere = { count: 0, startedAt: now };
    this.everywhere.count += 1;
    if (this.everywhere.count > MAX_EVERYWHERE_PER_HOUR) return false;

    const record = this.byAddress.get(address);
    if (!record || now - record.startedAt >= WINDOW_MS) {
      this.byAddress.set(address, { count: 1, startedAt: now });
      this.forgetStale(now);
      return true;
    }
    record.count += 1;
    return record.count <= MAX_PER_WINDOW;
  }

  private forgetStale(now: number): void {
    for (const [key, record] of this.byAddress) {
      if (now - record.startedAt >= WINDOW_MS) this.byAddress.delete(key);
    }
  }
}
