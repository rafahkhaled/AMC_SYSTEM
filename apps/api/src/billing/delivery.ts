import type { DocumentDelivery } from '@amc/billing';
import type { Database } from '@amc/database';
import type { IdGenerator } from '@amc/kernel';
import { SystemClock } from '@amc/kernel';
import { PostgresJobQueue } from '@amc/queue';
import { sql } from 'drizzle-orm';

/** The job the worker drains to actually send the mail. */
export const QUOTATION_EMAIL_JOB = 'billing.quotation.email';

/*
 * A type alias and not an interface.
 *
 * The queue types a payload as `Record<string, unknown>`, and TypeScript gives
 * an implicit index signature to a type alias of an object literal but not to
 * an interface. This is the third time that has bitten in this repository.
 */
export type QuotationEmailPayload = {
  readonly quotationId: string;
  readonly clientId: string;
  readonly reference: string;
  readonly to: string;
  readonly contactName: string;
  readonly clientName: string;
  readonly totalMinor: number;
  readonly currency: string;
  readonly validUntil: string | null;
};

/**
 * Sending a quotation to the client, and writing it down (FR-30, FR-06).
 *
 * Lives in the composition root because it reaches three modules at once: the
 * quotation is billing's, the contact is the client module's, and the mail
 * belongs to neither. Billing asks for delivery and is told which channel it
 * went by; it never learns what a client contact is.
 *
 * Queued rather than sent inside the request. The outbox and the worker
 * already own sending, and an SMTP call inside a POST is a request that hangs
 * when the mail host is slow and a quotation marked sent when it times out.
 * The job and the contact-log row go in one transaction with nothing else, so
 * a quotation is never recorded as emailed without the mail being queued.
 */
export function quotationDelivery(db: Database, ids: IdGenerator): DocumentDelivery {
  const queue = new PostgresJobQueue(db, ids, new SystemClock());

  return {
    async quotation(params) {
      const [contact] = await db.execute<{
        id: string;
        name: string;
        email: string;
        client_name: string;
      }>(sql`
        SELECT c.id, c.name, c.email, cl.legal_name AS client_name
        FROM client_contacts c
        JOIN clients cl ON cl.id = c.client_id
        WHERE c.client_id = ${params.clientId}
          AND c.email IS NOT NULL
        -- The primary contact first, then whoever else has an address: a
        -- client with one unmarked contact is the ordinary case, not an error.
        ORDER BY c.is_primary DESC, c.created_at ASC
        LIMIT 1
      `);

      if (!contact) return null;

      await db.transaction(async (transaction) => {
        await queue.enqueue(
          {
            name: QUOTATION_EMAIL_JOB,
            payload: {
              quotationId: params.quotationId,
              clientId: params.clientId,
              reference: params.reference,
              to: contact.email,
              contactName: contact.name,
              clientName: contact.client_name,
              totalMinor: params.total.minorUnits,
              currency: params.total.currency,
              validUntil: params.validUntil?.toISOString() ?? null,
            } satisfies QuotationEmailPayload,
            // One live job per quotation. Pressing send twice should not send
            // the client the same offer twice.
            uniqueKey: `${QUOTATION_EMAIL_JOB}:${params.quotationId}`,
          },
          transaction as unknown as Database,
        );

        await transaction.execute(sql`
          INSERT INTO client_contact_log
            (id, client_id, contact_id, channel, direction, happened_at, summary)
          VALUES (
            ${ids.next()}, ${params.clientId}, ${contact.id}, 'email', 'outbound', now(),
            ${`Quotation ${params.reference} emailed to ${contact.email}`}
          )
        `);
      });

      return 'email';
    },
  };
}
