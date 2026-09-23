import type { EmailSender } from '@amc/notifications';

/** Must match the name the API enqueues under. */
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
 * Telling a client their quotation is ready (FR-30).
 *
 * Bilingual in one message rather than two, because the firm does not record
 * which language a client reads and guessing wrong on a quotation is worse
 * than sending both. Arabic first: it is the working language.
 *
 * The figure is in the mail so the client can act on it without opening
 * anything, and the document itself still goes as an attachment by hand —
 * there is no server-side PDF and no client portal to link to yet. The
 * wording says so rather than implying an attachment that is not there.
 */
export function quotationEmail(payload: QuotationEmailPayload): {
  to: string;
  subject: string;
  body: string;
} {
  const amount = `${payload.currency} ${(payload.totalMinor / 100).toFixed(2)}`;
  const until = payload.validUntil ? payload.validUntil.slice(0, 10) : null;

  const arabic = [
    `السادة ${payload.contactName}،`,
    '',
    `يسرّنا موافاتكم بعرض السعر رقم ${payload.reference} باسم ${payload.clientName}.`,
    `القيمة الإجمالية: ${amount}.`,
    ...(until ? [`العرض صالح حتى ${until}.`] : []),
    '',
    'سيصلكم العرض بصيغته الكاملة من فريقنا. للموافقة أو لأي استفسار، يكفي الرد على هذه الرسالة.',
  ];

  const english = [
    `Dear ${payload.contactName},`,
    '',
    `Please find quotation ${payload.reference} for ${payload.clientName}.`,
    `Total: ${amount}.`,
    ...(until ? [`This quotation is valid until ${until}.`] : []),
    '',
    'The full quotation will follow from our team. To accept, or if anything needs changing, simply reply to this message.',
  ];

  return {
    to: payload.to,
    subject: `عرض سعر ${payload.reference} · Quotation ${payload.reference}`,
    body: [...arabic, '', '—', '', ...english].join('\n'),
  };
}

export async function sendQuotationEmail(
  email: EmailSender,
  payload: QuotationEmailPayload,
): Promise<void> {
  await email.send(quotationEmail(payload));
}
