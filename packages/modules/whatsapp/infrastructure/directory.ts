import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ContactDirectory } from '../application/ports.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

type MatchRow = {
  client_id: string;
  contact_id: string;
  contact_name: string;
  is_primary: boolean;
};

/**
 * Whose number this is.
 *
 * The comparison is on `phone_e164`, the generated column from migration 0023,
 * never on `phone` — the raw column holds whatever the accountant typed, and
 * `050 123 4567` does not equal `971501234567` by any comparison a database
 * will do for you.
 *
 * It returns nothing rather than a best guess. An unmatched conversation is
 * handled properly by the rest of this module — a person is fetched, and they
 * say whose it is — whereas a wrong match files somebody's trade licence
 * against another company, and nobody finds out until that company is asked for
 * a document they already sent.
 */
export class DrizzleContactDirectory implements ContactDirectory {
  constructor(private readonly db: Db) {}

  async whoseNumber(phone: string): Promise<{
    clientId: string;
    contactId: string | null;
    contactName: string | null;
    language: null;
  } | null> {
    /*
     * One number can be on two contacts. It happens: an owner listed at two of
     * their own companies, or an accountant's mobile written into a client's
     * record by mistake.
     *
     * The primary contact wins, and then the oldest record, so the answer is at
     * least stable — the same message must not land against one client today
     * and another tomorrow. When the tie is real it is the wrong kind of
     * problem to solve by guessing harder, which is why a second match is
     * reported as ambiguous rather than picked.
     */
    const rows = await this.db.execute<MatchRow>(sql`
      SELECT k.client_id, k.id AS contact_id, k.name AS contact_name, k.is_primary
      FROM client_contacts k
      JOIN clients cl ON cl.id = k.client_id
      WHERE k.phone_e164 = ${phone}
        AND cl.status <> 'closed'
      ORDER BY k.is_primary DESC, k.created_at, k.id
      LIMIT 2
    `);

    const first = rows[0];
    if (!first) return null;

    // Two different clients share this number, and no rule here can say which
    // one wrote. Treated as unknown, which sends it to a person — the only
    // party who can actually tell.
    const second = rows[1];
    if (second && second.client_id !== first.client_id) return null;

    return {
      clientId: first.client_id,
      contactId: first.contact_id,
      contactName: first.contact_name,
      /*
       * Nothing records which language a client reads — there is no such column
       * on `clients` and inventing one here would be guessing on behalf of the
       * practice. Null, so the conversation learns it from what they actually
       * write, which is a better source than a field somebody set once at
       * onboarding and never revisited.
       */
      language: null,
    };
  }
}
