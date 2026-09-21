import type { ReceiveDocument } from '@amc/clients';
import type { Database } from '@amc/database';
import { type CallerLike, Conflict, type IdGenerator, err } from '@amc/kernel';
import { Notification } from '@amc/notifications/domain';
import { DrizzleNotificationRepository } from '@amc/notifications/infrastructure';
import type {
  ContactLogWriter,
  DeadlineReader,
  DocumentFiler,
  StaffNotifier,
  StaffPicker,
} from '@amc/whatsapp';
import { sql } from 'drizzle-orm';

/**
 * Joining WhatsApp to the rest of the system.
 *
 * Every function here is a join between two modules, so none of them may live
 * in either — the WhatsApp module declares what it needs and the composition
 * root supplies it. This is the same arrangement `task-summaries.ts` uses for
 * the clients screen and for the same reason.
 */

/**
 * Who the system is when a client writes in.
 *
 * A message arrives with nobody signed in, so anything that goes through a
 * scoped use case needs a caller. This one may see every client, which is both
 * correct — a message can come from any of them — and the reason it is defined
 * here, in the open, rather than assembled inside the WhatsApp module: a module
 * that invents its own caller has quietly decided its own access rules.
 *
 * It is never used for anything a person asked for. Every staff-initiated path
 * carries the real caller and is scoped by it.
 */
export const WHATSAPP_SYSTEM_CALLER: CallerLike = {
  userId: 'system:whatsapp',
  permissions: new Set(['clients.view.all', 'clients.edit']),
  roles: ['system'],
  displayName: 'WhatsApp',
};

/**
 * Writing what was said into the contact log (PW-04).
 *
 * Raw SQL with a null `user_id`, rather than through the clients module's own
 * use case, because that one requires a caller and every value it would take is
 * a fiction here: nobody at the practice typed this. A null user is exactly
 * what the column was made nullable for, and it is what lets the screen say
 * "WhatsApp" instead of attributing a bot's message to a person who was
 * asleep.
 */
export function contactLogWriter(db: Database, ids: IdGenerator): ContactLogWriter {
  return {
    async record(entry) {
      const id = ids.next();
      await db.execute(sql`
        INSERT INTO client_contact_log
          (id, client_id, contact_id, user_id, channel, direction, happened_at, summary)
        VALUES (
          ${id}, ${entry.clientId}, ${entry.contactId ?? null}, NULL,
          'whatsapp', ${entry.direction}, ${entry.happenedAt.toISOString()}, ${entry.summary}
        )
      `);
      return id;
    },
  };
}

/**
 * Filing an attachment a client sent (PW-06).
 *
 * Typed `other` and nothing else. The bot has no way to tell a trade licence
 * from a tenancy contract, and a guess here is worse than no guess: a document
 * filed as a trade licence inherits that type's expiry chasing, so a wrong
 * guess produces a renewal reminder for a document that never expires — or,
 * worse, silences the reminder for one that does.
 *
 * It goes through the clients module's own use case rather than an insert,
 * because that use case is what supersedes the previous version in the right
 * order, and doing it backwards is a bug this project has already had.
 */
export function documentFiler(documents: ReceiveDocument): DocumentFiler {
  return {
    async file(params) {
      const filed = await documents.execute(WHATSAPP_SYSTEM_CALLER, {
        clientId: params.clientId,
        type: 'other',
        // What it is, in the list: the label is all anybody has to go on until
        // somebody opens it.
        label: `Sent on WhatsApp: ${params.filename}`,
        filename: params.filename,
        contentType: params.contentType,
        body: params.body,
      });
      if (!filed.ok) return err(new Conflict(filed.error.message));
      return filed;
    },
  };
}

/**
 * What this client owes and when (PW-05).
 *
 * Reads the same rows the calendar does rather than asking the deadline module
 * for a view, because the bot needs two strings and a date and the calendar's
 * view carries a month's worth of structure around them.
 *
 * Only what is genuinely outstanding: a filing already done is not something to
 * tell a client about, and listing it invites the reply "but I sent that".
 */
export function deadlineReader(db: Database): DeadlineReader {
  return {
    async upcomingFor(clientId, withinDays) {
      const rows = await db.execute<{
        service: string;
        period_key: string | null;
        due_at: string;
      }>(sql`
        SELECT t.service, t.period_key, t.due_at
        FROM tasks t
        WHERE t.client_id = ${clientId}
          AND t.state NOT IN ('completed', 'cancelled')
          AND t.due_at IS NOT NULL
          AND t.due_at <= now() + make_interval(days => ${withinDays})
        ORDER BY t.due_at
        LIMIT 10
      `);

      const now = Date.now();
      return rows.map((row) => {
        const due = new Date(row.due_at);
        return {
          label: labelFor(row.service, row.period_key),
          dueOn: readableDate(due),
          overdue: due.getTime() < now,
        };
      });
    },
  };
}

/**
 * The date as a person reads it, in each language.
 *
 * Not an ISO stamp: this goes to a phone, where 2026-11-28 reads as a serial
 * number. And not one string for both languages, which is what it was —
 * `بتاريخ 28 August 2026` is half a sentence in each, and the half a client
 * cannot read is the half that carries the deadline.
 *
 * Dubai time, because a filing due on the 28th is due on the 28th there, and a
 * date rendered in UTC is a day early for a third of the evening.
 */
function readableDate(due: Date): { en: string; ar: string } {
  const options = {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Dubai',
  } as const;
  return {
    en: due.toLocaleDateString('en-GB', options),
    ar: due.toLocaleDateString('ar-AE', options),
  };
}

/**
 * What to call a piece of work, in both languages.
 *
 * A small list rather than a lookup, because these are the only services whose
 * deadlines a client would ever ask a bot about. Anything else is named
 * generically instead of exposing an internal code to somebody's phone.
 */
function labelFor(service: string, periodKey: string | null): { en: string; ar: string } {
  const period = periodKey ? ` ${periodKey}` : '';
  switch (service) {
    case 'vat_return':
      return { en: `VAT return${period}`, ar: `الإقرار الضريبي${period}` };
    case 'ct_return':
      return { en: `Corporate tax return${period}`, ar: `إقرار ضريبة الشركات${period}` };
    case 'bookkeeping':
      return { en: `Bookkeeping${period}`, ar: `مسك الدفاتر${period}` };
    default:
      return { en: `Work in progress${period}`, ar: `أعمال قيد التنفيذ${period}` };
  }
}

/**
 * Who should pick a conversation up (PW-05).
 *
 * The client's own accountant, because being handed to a stranger who has to
 * ask who you are is most of what makes people dislike a chatbot. The longest
 * standing assignment wins when there are several, which is a proxy for who
 * knows the client best and, more importantly, is stable.
 */
export function staffPicker(db: Database): StaffPicker {
  return {
    async forClient(clientId) {
      if (!clientId) return null;
      const rows = await db.execute<{ user_id: string }>(sql`
        SELECT a.user_id
        FROM client_staff_access a
        JOIN users u ON u.id = a.user_id
        WHERE a.client_id = ${clientId} AND u.status = 'active'
        ORDER BY a.assigned_at
        LIMIT 1
      `);
      return rows[0] ? { userId: rows[0].user_id } : null;
    },

    /**
     * Whoever answers the unmatched ones.
     *
     * The manager, because an unrecognised number is a question about who a
     * client is, and that is not a question an accountant can answer for
     * somebody else's client. It is also where a new enquiry lands, which is
     * work the practice wants seen.
     */
    async onDuty() {
      const rows = await db.execute<{ user_id: string }>(sql`
        SELECT r.user_id
        FROM user_roles r
        JOIN users u ON u.id = r.user_id
        WHERE r.role = 'manager' AND u.status = 'active'
        ORDER BY u.created_at
        LIMIT 1
      `);
      return rows[0] ? { userId: rows[0].user_id } : null;
    },
  };
}

/**
 * Telling somebody a conversation is waiting for them (PW-05).
 *
 * Straight into the inbox, with no email. That is a decision and not an
 * omission: a handover is actioned on the WhatsApp screen, within minutes,
 * by somebody who is already at their desk — and a practice that receives an
 * email every time a client sends "شكرا" stops reading the emails, including
 * the ones about a deadline.
 *
 * It uses the notifications module's own aggregate and repository rather than
 * its `Notify` use case, because `Notify` exists to decide between inbox and
 * email and there is nothing here to decide. Storing it through `raise` keeps
 * the same idempotency: one notification per person per conversation, enforced
 * in the database, so a webhook Meta delivers three times tells somebody once.
 */
export function staffNotifier(db: Database, ids: IdGenerator): StaffNotifier {
  const notifications = new DrizzleNotificationRepository(db);

  return {
    async conversationNeedsYou(params) {
      // Enough of the message to know whether it can wait, and not so much
      // that the inbox becomes the place people read WhatsApp.
      const said = params.said.length > 120 ? `${params.said.slice(0, 117)}…` : params.said;

      const notification = Notification.raise({
        id: ids.next(),
        userId: params.userId,
        kind: 'escalation',
        // The conversation, not the message: by the time anybody opens it
        // there may be three more, and the thread is what they need.
        subjectType: 'whatsapp_conversation',
        subjectId: params.conversationId,
        clientId: params.clientId,
        wording: {
          titleEn: 'A client is waiting on WhatsApp',
          titleAr: 'عميل بانتظار الرد على واتساب',
          bodyEn: `${params.phone} wrote: "${said}"`,
          bodyAr: `${params.phone} كتب: "${said}"`,
        },
        now: new Date(),
      });
      // A refusal here is a programming mistake, not a runtime condition, and
      // it must not cost the client their reply. The conversation is already
      // handed over; this is only the telling.
      if (!notification.ok) return;

      await notifications.raise(notification.value);
    },
  };
}
