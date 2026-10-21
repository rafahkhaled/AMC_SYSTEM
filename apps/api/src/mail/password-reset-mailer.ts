import type { PasswordResetMailer } from '@amc/identity';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

/** What an email says. Arabic first: the firm's own people read it that way. */
function compose(params: { displayName: string; link: string }): { subject: string; body: string } {
  return {
    subject: 'إعادة تعيين كلمة المرور · Reset your password',
    body: [
      `مرحبًا ${params.displayName}،`,
      '',
      'طلبتَ إعادة تعيين كلمة المرور لنظام Active Management Consultancy. افتح الرابط التالي لاختيار كلمة مرور جديدة. الرابط صالح لمدة ساعة واحدة ويعمل مرة واحدة فقط:',
      params.link,
      '',
      'إذا لم تطلب ذلك فتجاهل هذه الرسالة، ولن يتغيّر شيء.',
      '',
      '—',
      '',
      `Hello ${params.displayName},`,
      '',
      'You asked to reset your password for the Active Management Consultancy system. Open this link to choose a new one. It works for one hour and only once:',
      params.link,
      '',
      'If you did not ask for this, ignore this message and nothing will change.',
    ].join('\n'),
  };
}

/**
 * Sends the reset link by Amazon SES when a verified sender is configured, and
 * otherwise writes it to the server log.
 *
 * Writing a working link to a log is deliberate and only happens with no mail
 * transport: whoever can read this server's logs already controls the server,
 * and it gives a practice that has not set up email a way to recover an account
 * rather than none. Once a sender is configured the link is never logged.
 */
export function passwordResetMailer(params: {
  appUrl: string;
  from: string | undefined;
  region: string;
  logger: { warn(message: string): void };
}): PasswordResetMailer {
  const client = params.from ? new SESv2Client({ region: params.region }) : null;

  return {
    async send({ to, displayName, token }) {
      const link = `${params.appUrl.replace(/\/+$/, '')}/?reset=${encodeURIComponent(token)}`;
      if (!client || !params.from) {
        params.logger.warn(
          `Password reset for ${to}: no mail transport is configured, so the link is here instead: ${link}`,
        );
        return;
      }
      const { subject, body } = compose({ displayName, link });
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: params.from,
          Destination: { ToAddresses: [to] },
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: { Text: { Data: body, Charset: 'UTF-8' } },
            },
          },
        }),
      );
    },
  };
}
