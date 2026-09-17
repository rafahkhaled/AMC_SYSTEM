import type { Database } from '@amc/database';
import type { EmailSender, RecipientReader } from '@amc/notifications';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

/**
 * Who to email, and in which language.
 *
 * Lives here because it reaches the identity module's users table and the
 * notifications module should not learn it. The language is not stored yet —
 * it is a browser preference — so Arabic is assumed, which is the working
 * language of the practice.
 */
export function recipientReader(db: Database): RecipientReader {
  return {
    async find(userId) {
      const [row] = await db.execute<{ email: string }>(sql`
        SELECT email FROM users WHERE id = ${userId} AND status = 'active'
      `);
      // Somebody suspended is not emailed. Their inbox entry still exists, so
      // the record that they were told is not lost if they come back.
      return row ? { email: row.email, language: 'ar' as const } : null;
    },
  };
}

/**
 * Writes the email to the log instead of sending it.
 *
 * Development and test. It exists so the path runs for real — the preference
 * is read, the recipient is looked up, the wording is chosen in the right
 * language — rather than being skipped until the day it is first tried in
 * production. Only the last step differs.
 */
export function loggingEmailSender(logger: Logger): EmailSender {
  return {
    async send(message) {
      logger.info(
        { to: message.to, subject: message.subject },
        'email not sent: no mail transport is configured',
      );
    },
  };
}

/**
 * Amazon Simple Email Service, in me-central-1 (FR-43).
 *
 * Plain text rather than HTML. These are one-line notices — "the documents for
 * this client have not arrived" — and a styled email is more to go wrong, more
 * likely to be filtered, and no easier to read on a phone.
 *
 * A failure throws. The caller swallows it on purpose, because the inbox entry
 * is the record that somebody was told and losing that over a mail server
 * being briefly down would be the worse failure.
 */
export function sesEmailSender(params: {
  region: string;
  from: string;
  client?: SESv2Client;
}): EmailSender {
  const client = params.client ?? new SESv2Client({ region: params.region });

  return {
    async send(message) {
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: params.from,
          Destination: { ToAddresses: [message.to] },
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: 'UTF-8' },
              Body: { Text: { Data: message.body, Charset: 'UTF-8' } },
            },
          },
        }),
      );
    },
  };
}
