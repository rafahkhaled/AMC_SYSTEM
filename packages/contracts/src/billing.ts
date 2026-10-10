import { z } from 'zod';

/** Money crosses the wire as whole minor units, never as a decimal. */
const moneySchema = z.object({
  minorUnits: z.number().int(),
  currency: z.string(),
});

export const statementLineSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  service: z.string(),
  /** The day the work was done, which is what chose the rate. */
  performedOn: z.string(),
  userId: z.string().nullable(),
  userName: z.string().nullable(),
  workedSeconds: z.number().int().nonnegative(),
  /**
   * How the line is charged.
   *
   * A fixed fee has no rate. Showing one derived from the hours would put a
   * number on screen that moves every time somebody records more time.
   */
  pricing: z.enum(['hourly', 'fixed']),
  perHour: moneySchema.nullable(),
  /** What the clock said, before anybody excluded or adjusted it. */
  asWorked: moneySchema,
  /** What will be billed. */
  amount: moneySchema,
  excluded: z.boolean(),
  excludedReason: z.string().nullable(),
  adjustedTo: moneySchema.nullable(),
  adjustedReason: z.string().nullable(),
});
export type StatementLineView = z.infer<typeof statementLineSchema>;

export const statementSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string().nullable(),
  periodStart: z.string(),
  periodEnd: z.string(),
  state: z.enum(['draft', 'approved', 'invoiced', 'cancelled']),
  currency: z.string(),
  lines: z.array(statementLineSchema),
  /** The three figures a reviewer compares. */
  totalAsWorked: moneySchema,
  total: moneySchema,
  workedSeconds: z.number().int().nonnegative(),
  approvedAt: z.string().nullable(),
  approvedBy: z.string().nullable(),
  createdAt: z.string(),
});
export type StatementView = z.infer<typeof statementSchema>;

export const statementsSchema = z.object({ statements: z.array(statementSchema) });
export type Statements = z.infer<typeof statementsSchema>;

export const invoiceLineSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  service: z.string(),
  descriptionEn: z.string(),
  descriptionAr: z.string(),
  workedSeconds: z.number().int().nonnegative(),
  amount: moneySchema,
  /**
   * What the printed document's Qty and Rate columns show.
   *
   * Hundredths of a unit: 250 is two and a half hours, 100 is one fixed fee.
   * Both come off the invoice rather than being worked out here, because the
   * client holds a piece of paper and a reprint has to match it.
   */
  quantityCenti: z.number().int().positive(),
  unitRate: moneySchema.nullable(),
});
export type InvoiceLineView = z.infer<typeof invoiceLineSchema>;

export const paymentSchema = z.object({
  id: z.string(),
  amount: moneySchema,
  receivedOn: z.string(),
  method: z.string(),
  reference: z.string().nullable(),
  recordedBy: z.string(),
});
export type PaymentView = z.infer<typeof paymentSchema>;

export const invoiceSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string().nullable(),
  statementId: z.string(),
  number: z.string(),
  /**
   * One word for a screen. Lateness wins over part payment, because the reason
   * anybody opens this list is to decide who to chase — the underlying
   * settlement and the day it fell late are both here too.
   */
  status: z.enum(['issued', 'part_paid', 'paid', 'overdue', 'cancelled']),
  settlement: z.enum(['issued', 'part_paid', 'paid', 'cancelled']),
  currency: z.string(),
  lines: z.array(invoiceLineSchema),
  payments: z.array(paymentSchema),
  vatBasisPoints: z.number().int().nonnegative(),
  net: moneySchema,
  vat: moneySchema,
  total: moneySchema,
  paid: moneySchema,
  balance: moneySchema,
  issuedOn: z.string(),
  dueOn: z.string(),
  overdueSince: z.string().nullable(),
  /**
   * The existing-client exception, in the open (FR-34).
   *
   * True when money is owed on this invoice and the firm is still working for
   * the client anyway. Neither half is remarkable alone — an unpaid invoice is
   * ordinary, and open work is the business — but together they are the
   * decision somebody made to carry on before being paid, and the firm should
   * be able to see every one of them at a glance rather than discover them
   * one at a time.
   */
  collectionPending: z.boolean(),
  /** How much work is riding on it. Zero unless `collectionPending`. */
  openProjects: z.number().int().nonnegative(),
});
export type InvoiceView = z.infer<typeof invoiceSchema>;

export const invoicesSchema = z.object({ invoices: z.array(invoiceSchema) });
export type Invoices = z.infer<typeof invoicesSchema>;

export const generateStatementRequestSchema = z.object({
  clientId: z.string().min(1),
  /** Inclusive, as calendar days: 2026-09-01 to 2026-09-30. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type GenerateStatementRequest = z.infer<typeof generateStatementRequestSchema>;

/** Every revision needs a reason: "why is this not what the timesheet says". */
export const reviseLineRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  /** Present to adjust the figure, absent to exclude the line outright. */
  adjustToMinor: z.number().int().nonnegative().optional(),
});
export type ReviseLineRequest = z.infer<typeof reviseLineRequestSchema>;

export const recordPaymentRequestSchema = z
  .object({
    amountMinor: z.number().int().positive(),
    receivedOn: z.string(),
    method: z.enum(['bank_transfer', 'cheque', 'cash', 'card', 'other']),
    reference: z.string().trim().max(120).optional(),
    /** A cheque's own number and date, which is what gets chased. */
    chequeNumber: z.string().trim().max(60).optional(),
    chequeDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    bankName: z.string().trim().max(120).optional(),
    /**
     * What the firm agreed to drop.
     *
     * Recorded rather than folded into a smaller payment: an invoice that is
     * simply short looks like a debt for ever, and nobody can tell a
     * write-off from somebody who has not paid.
     */
    discountMinor: z.number().int().nonnegative().optional(),
    discountReason: z.string().trim().max(300).optional(),
  })
  .refine((payment) => !payment.discountMinor || Boolean(payment.discountReason?.trim()), {
    message: 'Say why the amount was reduced',
    path: ['discountReason'],
  })
  .refine((payment) => payment.method === 'cheque' || !payment.chequeNumber, {
    message: 'A cheque number belongs to a cheque',
    path: ['chequeNumber'],
  });
export type RecordPaymentRequest = z.infer<typeof recordPaymentRequestSchema>;

export const releaseStatementRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type ReleaseStatementRequest = z.infer<typeof releaseStatementRequestSchema>;

/* ---------------------------------------------------------------- quotations */

export const quotationLineSchema = z.object({
  id: z.string(),
  /** Which of the firm's services this line is for, where it is one of them. */
  serviceCode: z.string().nullable(),
  descriptionEn: z.string(),
  descriptionAr: z.string(),
  /** How it was priced, which still matters after the client says yes. */
  kind: z.enum(['hours', 'fixed']),
  hours: z.number().nullable(),
  perHour: moneySchema.nullable(),
  /** The agreed price of the line, before anything is taken off it. */
  amount: moneySchema,
  discount: moneySchema,
  /**
   * VAT on this line; 500 is five percent. Null is out of scope, which is a
   * different claim from zero and sits in a different box on the return.
   */
  vatBasisPoints: z.number().int().nonnegative().nullable(),
  /** After the discount, before VAT. */
  net: moneySchema,
  vat: moneySchema,
  /** What this line charges the client. */
  chargeable: moneySchema,
});
export type QuotationLineView = z.infer<typeof quotationLineSchema>;

export const quotationSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string().nullable(),
  /** What the client quotes back on the phone. */
  reference: z.string(),
  state: z.enum(['draft', 'sent', 'accepted', 'declined', 'expired']),
  currency: z.string(),
  lines: z.array(quotationLineSchema),
  /** Every line at its agreed price, before discounts. */
  subtotal: moneySchema,
  discount: moneySchema,
  /** After discounts, before VAT. */
  net: moneySchema,
  vat: moneySchema,
  /** What the client is actually being charged: net plus VAT. */
  total: moneySchema,
  validUntil: z.string().nullable(),
  sentAt: z.string().nullable(),
  /**
   * How it reached the client. `by_hand` means somebody printed it, which is
   * a real answer and a different claim from "we emailed it".
   */
  sentVia: z.enum(['email', 'by_hand']).nullable(),
  decidedAt: z.string().nullable(),
  notesEn: z.string().nullable(),
  notesAr: z.string().nullable(),
  createdAt: z.string(),
});
export type QuotationView = z.infer<typeof quotationSchema>;

export const quotationsSchema = z.object({ quotations: z.array(quotationSchema) });
export type Quotations = z.infer<typeof quotationsSchema>;

export const draftQuotationRequestSchema = z.object({
  clientId: z.string().min(1),
  /**
   * Left out for anything drafted here, which takes the next number from the
   * firm's own estimate sequence. Given only when recording a quotation that
   * was issued by hand before this system existed.
   */
  reference: z.string().trim().min(1).max(60).optional(),
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  notesEn: z.string().trim().max(2000).optional(),
  notesAr: z.string().trim().max(2000).optional(),
});
export type DraftQuotationRequest = z.infer<typeof draftQuotationRequestSchema>;

/**
 * A line, priced one way or the other.
 *
 * `hours` carries an estimate and a rate; `amount` a fixed fee. Which was
 * offered is kept because a fixed fee accepted at 5,000 is still 5,000 when
 * the work runs long, and an hourly estimate is not.
 */
export const addQuotationLineRequestSchema = z
  .object({
    /**
     * One of the eleven services, where the line is one of them.
     *
     * Checked against the list rather than taken as free text, so that a
     * quotation line and the project eventually opened for it name the same
     * service. Left out for a line that is not a service at all.
     */
    // A code, not an enum: the firm can add services of its own, and the
    // billing module does not know what exists in the projects module. The
    // shape is checked here and the screen only offers real ones.
    serviceCode: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .optional(),
    descriptionEn: z.string().trim().max(300).optional(),
    descriptionAr: z.string().trim().max(300).optional(),
    hours: z.number().positive().max(10_000).optional(),
    perHourMinor: z.number().int().nonnegative().optional(),
    amountMinor: z.number().int().nonnegative().optional(),
    /** Off this line, before VAT. Never more than the line itself. */
    discountMinor: z.number().int().nonnegative().optional(),
    /**
     * Whether VAT applies, rather than at what rate.
     *
     * The rate itself comes from the firm's own configuration, so a quotation
     * and the invoice that eventually follows it cannot disagree about what
     * five percent is. Required, with no default: a line that forgot to say
     * quietly under-quotes the client by the VAT, and nobody notices until
     * the invoice is five percent larger than the offer.
     */
    vat: z.enum(['standard', 'out_of_scope'], {
      // Otherwise a line sent without it is refused with the word
      // "Required", and the screen shows the client's accountant that.
      required_error: 'Say whether VAT applies to this line, or that it is out of scope',
      invalid_type_error: 'Say whether VAT applies to this line, or that it is out of scope',
    }),
  })
  .refine(
    (line) =>
      (line.hours !== undefined && line.perHourMinor !== undefined) !==
      (line.amountMinor !== undefined),
    { message: 'Price it by hours and a rate, or as a fixed amount, but not both' },
  )
  .refine((line) => Boolean(line.descriptionEn?.trim() || line.descriptionAr?.trim()), {
    message: 'Say what the line is for, in at least one language',
  });
export type AddQuotationLineRequest = z.infer<typeof addQuotationLineRequestSchema>;

/* ------------------------------------------------------------------ reports */

/**
 * Hours, and what became of them (FR-35).
 *
 * Recorded splits into billed and unbilled, and the split is the point: a
 * large unbilled figure is either work in progress or work quietly given
 * away, and a practice cannot tell which without looking.
 */
export const hoursRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  recordedSeconds: z.number().int().nonnegative(),
  billedSeconds: z.number().int().nonnegative(),
  unbilledSeconds: z.number().int().nonnegative(),
  /** What the billed hours were actually charged at. */
  billedAmount: moneySchema,
});
export type HoursRow = z.infer<typeof hoursRowSchema>;

export const hoursReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  by: z.enum(['client', 'person', 'service']),
  rows: z.array(hoursRowSchema),
  totals: hoursRowSchema,
});
export type HoursReport = z.infer<typeof hoursReportSchema>;

/**
 * What a client is worth (FR-35).
 *
 * The number that matters under a fixed fee is the effective hourly rate:
 * what was invoiced divided by the hours it took. A practice billing 1,750
 * for twelve hours is earning 145 an hour against a standard rate of 300, and
 * nothing else on this report says so as plainly.
 *
 * Null when no hours were recorded — dividing by nothing produces a figure
 * that looks like a triumph.
 */
export const profitabilityRowSchema = z.object({
  clientId: z.string(),
  clientName: z.string(),
  recordedSeconds: z.number().int().nonnegative(),
  /**
   * What the firm earned, before VAT.
   *
   * VAT is collected for the FTA and never belongs to the practice, so it is
   * the net figure that divides into hours. Kept apart from `grossInvoiced`
   * because a net figure sitting beside a VAT-inclusive `paid` reads as an
   * overpayment when the client has in fact paid exactly the invoice.
   */
  netInvoiced: moneySchema,
  /** What the client was asked to pay: net plus VAT. */
  grossInvoiced: moneySchema,
  paid: moneySchema,
  /** Gross against gross. Never negative: an overpayment shows as settled. */
  outstanding: moneySchema,
  effectivePerHour: moneySchema.nullable(),
  /** The client's own rate, for comparison. */
  standardPerHour: moneySchema,
});
export type ProfitabilityRow = z.infer<typeof profitabilityRowSchema>;

export const profitabilityReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(profitabilityRowSchema),
});
export type ProfitabilityReport = z.infer<typeof profitabilityReportSchema>;

/* ---------------------------------------------------------------- documents */

/**
 * What the firm puts on its own paper.
 *
 * Read from configuration, and read fresh every time a document is drawn.
 *
 * Known limitation, written down because it will not announce itself: an
 * invoice is a record of what was sent, and this profile is not snapshotted
 * onto it. Reprint an invoice from last year after the firm changes bank and
 * it will carry this year's IBAN. That is wrong for a tax document and the
 * fix is a snapshot taken when the invoice is raised, which is a schema change
 * and deserves to be made deliberately rather than bolted onto the renderer.
 *
 * Every field but the name is nullable, and a null prints as a visible marker
 * rather than a gap: a document with a blank where the IBAN should be reads
 * as finished and is not.
 */
export const firmProfileSchema = z.object({
  legalName: z.string(),
  addresses: z.array(z.string()),
  bank: z
    .object({
      accountHolder: z.string().nullable(),
      iban: z.string().nullable(),
      bic: z.string().nullable(),
    })
    .nullable(),
  logoUrl: z.string().nullable(),
  stampUrl: z.string().nullable(),
  /**
   * The firm's VAT rate, in basis points. 500 is five percent.
   *
   * Sent so that a screen offering "standard rate" can name the rate it is
   * actually offering. A selector that says five percent while the server is
   * configured at nothing quotes the client one figure and bills another,
   * and nobody finds out until the invoice arrives.
   *
   * Zero for a firm that is not registered for VAT, which is why it is a
   * number and not a flag.
   */
  vatBasisPoints: z.number().int().nonnegative(),
});
export type FirmProfile = z.infer<typeof firmProfileSchema>;

/** Whether the system should send the quotation, or only record that it went. */
export const sendQuotationSchema = z.object({
  deliver: z.boolean().optional(),
});
export type SendQuotationRequest = z.infer<typeof sendQuotationSchema>;

/* ------------------------------------------------------- the client's link */

/**
 * What a client sees when they open the link they were sent (FR-30).
 *
 * Deliberately smaller than QuotationView: no client id, no notes on who
 * drafted it, no internal state beyond whether they may still answer. This is
 * the one view a person outside the firm can reach, and it should show them
 * nothing they would not already have on the paper version.
 */
export const clientQuotationSchema = z.object({
  /**
   * Who sent it.
   *
   * A client opening an unfamiliar link to a page showing their own prices,
   * with nothing on it saying which firm it came from, has every reason to
   * close the tab. They already know the name; the page should say it.
   */
  firmName: z.string(),
  reference: z.string(),
  state: z.enum(['draft', 'sent', 'accepted', 'declined', 'expired']),
  currency: z.string(),
  lines: z.array(
    z.object({
      descriptionEn: z.string(),
      descriptionAr: z.string(),
      /** The agreed price of the line, before anything is taken off. */
      amount: moneySchema,
      discount: moneySchema,
      /** Null where the line is out of the scope of VAT. */
      vatBasisPoints: z.number().int().nonnegative().nullable(),
      vat: moneySchema,
      /** What this line charges them. */
      chargeable: moneySchema,
    }),
  ),
  /*
   * The breakdown, because the client is being asked to agree to it.
   *
   * A page showing only a total asks somebody to accept a figure they cannot
   * check. The discount in particular is the firm's own argument for the
   * price and should be on the page it is making the argument on.
   */
  subtotal: moneySchema,
  discount: moneySchema,
  net: moneySchema,
  vat: moneySchema,
  /** Net plus VAT: what they pay if they say yes. */
  total: moneySchema,
  validUntil: z.string().nullable(),
  notesEn: z.string().nullable(),
  notesAr: z.string().nullable(),
  /** False once answered or lapsed, so the page shows the outcome instead. */
  answerable: z.boolean(),
});
export type ClientQuotationView = z.infer<typeof clientQuotationSchema>;

export const answerQuotationSchema = z.object({ decision: z.enum(['accept', 'decline']) });
export type AnswerQuotationRequest = z.infer<typeof answerQuotationSchema>;
