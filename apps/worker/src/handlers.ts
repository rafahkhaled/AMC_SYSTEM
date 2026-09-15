import type { JobRunner } from '@amc/queue';
import type { OutboxPublisher } from './outbox-publisher.js';

/**
 * Where each phase plugs its background work in.
 *
 * Nothing is registered yet, and that is honest rather than empty: the first
 * handlers arrive with the deadline engine in P1, which computes VAT and
 * corporation tax dates and fires the escalations at seven, fourteen and five
 * days. The invoice extraction pipeline follows in P3.
 *
 * The one rule for anything registered here: a handler must tolerate seeing
 * the same work twice. Delivery is at-least-once, and a job that is not safe
 * to repeat will eventually be repeated.
 */
export function registerJobHandlers(runner: JobRunner): JobRunner {
  return runner;
}

export function registerEventSubscribers(publisher: OutboxPublisher): OutboxPublisher {
  return publisher;
}
