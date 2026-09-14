import type { DomainEvent } from './domain-event.js';

/**
 * The base of every aggregate. It holds the events the aggregate recorded
 * during this unit of work; the unit of work drains them on commit and hands
 * them to the outbox. Nothing else may read them, which is why the list is
 * private and pulling it empties it.
 */
export abstract class AggregateRoot<TId extends string = string> {
  #pendingEvents: DomainEvent[] = [];

  protected constructor(readonly id: TId) {}

  protected record(event: DomainEvent): void {
    this.#pendingEvents.push(event);
  }

  /** Take the recorded events and clear them. Called by the unit of work. */
  pullEvents(): readonly DomainEvent[] {
    const events = this.#pendingEvents;
    this.#pendingEvents = [];
    return events;
  }

  get hasPendingEvents(): boolean {
    return this.#pendingEvents.length > 0;
  }
}
