import type { MessageRepository, StatusUpdate } from './ports.js';

/**
 * What Meta says happened to a message we sent.
 *
 * Delivery receipts arrive on the same webhook as the messages, minutes or
 * hours later, and they are the difference between "we sent it" and "they got
 * it". For a practice whose case for chasing a client rests on having asked
 * three times, that difference is the whole point of keeping the record.
 *
 * Statuses arrive out of order and they arrive more than once — Meta retries,
 * and `read` can precede `delivered` on a slow connection. The aggregate
 * refuses to move backwards, so this can apply everything it is given without
 * caring what order it came in.
 */
export class RecordDelivery {
  constructor(private readonly messages: MessageRepository) {}

  async apply(updates: readonly StatusUpdate[]): Promise<{ applied: number; unknown: number }> {
    let applied = 0;
    let unknown = 0;

    for (const update of updates) {
      const message = await this.messages.findByProviderId(update.providerMessageId);
      if (!message) {
        /*
         * A receipt for a message this system has no record of.
         *
         * It happens legitimately: somebody at the practice replies from their
         * own phone on the same business number, and Meta reports the delivery
         * to the webhook all the same. Counted rather than treated as an error,
         * because a rising count means something else is wrong.
         */
        unknown += 1;
        continue;
      }

      const before = message.snapshot().status;
      message.advanceTo(update.status, update.detail);
      if (message.snapshot().status !== before) {
        await this.messages.save(message);
        applied += 1;
      }
    }

    return { applied, unknown };
  }
}
