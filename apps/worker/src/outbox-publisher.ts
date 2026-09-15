import type { OutboxReader } from '@amc/audit';
import type { Clock, DomainEvent } from '@amc/kernel';

export type EventSubscriber = (event: DomainEvent) => Promise<void>;

/**
 * Delivers what the outbox holds.
 *
 * Delivery is at-least-once, never exactly-once, because the alternative does
 * not exist over a network. A subscriber may therefore see the same event
 * twice and must be written to tolerate it; the natural keys on tasks and jobs
 * are how that is achieved elsewhere in this system.
 *
 * One subscriber failing does not hold up the rest: the event is left
 * unpublished with its error recorded, and tried again on the next pass.
 */
export class OutboxPublisher {
  private readonly subscribers = new Map<string, EventSubscriber[]>();

  constructor(
    private readonly outbox: OutboxReader,
    private readonly clock: Clock,
    private readonly batchSize: number,
    private readonly onEvent?: (message: string, detail: Record<string, unknown>) => void,
  ) {}

  /** Subscribe to one event name, or to a prefix such as "identity." */
  on(pattern: string, subscriber: EventSubscriber): this {
    const existing = this.subscribers.get(pattern) ?? [];
    existing.push(subscriber);
    this.subscribers.set(pattern, existing);
    return this;
  }

  private subscribersFor(name: string): EventSubscriber[] {
    const matched: EventSubscriber[] = [];
    for (const [pattern, subscribers] of this.subscribers) {
      if (pattern === name || (pattern.endsWith('.') && name.startsWith(pattern))) {
        matched.push(...subscribers);
      }
    }
    return matched;
  }

  /** One pass. Returns how many events were delivered. */
  async drain(): Promise<number> {
    const pending = await this.outbox.pending(this.batchSize);
    if (pending.length === 0) return 0;

    const delivered: string[] = [];

    for (const record of pending) {
      const subscribers = this.subscribersFor(record.event.name);
      try {
        for (const subscriber of subscribers) {
          await subscriber(record.event);
        }
        delivered.push(record.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.outbox.markFailed(record.id, message);
        this.onEvent?.('outbox delivery failed', { event: record.event.name, error: message });
      }
    }

    // An event nobody listens to is still delivered. Marking it otherwise
    // would leave the table growing for ever over events that will never
    // have a subscriber.
    await this.outbox.markPublished(delivered, this.clock.now());
    return delivered.length;
  }
}
