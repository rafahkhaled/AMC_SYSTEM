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

export const recordPaymentRequestSchema = z.object({
  amountMinor: z.number().int().positive(),
  receivedOn: z.string(),
  method: z.enum(['bank_transfer', 'cheque', 'cash', 'card', 'other']),
  reference: z.string().trim().max(120).optional(),
});
export type RecordPaymentRequest = z.infer<typeof recordPaymentRequestSchema>;

export const releaseStatementRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type ReleaseStatementRequest = z.infer<typeof releaseStatementRequestSchema>;

/* ---------------------------------------------------------------- quotations */

export const quotationLineSchema = z.object({
  id: z.string(),
  descriptionEn: z.string(),
  descriptionAr: z.string(),
  /** How it was priced, which still matters after the client says yes. */
  kind: z.enum(['hours', 'fixed']),
  hours: z.number().nullable(),
  perHour: moneySchema.nullable(),
  amount: moneySchema,
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
  total: moneySchema,
  validUntil: z.string().nullable(),
  sentAt: z.string().nullable(),
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
  reference: z.string().trim().min(1).max(60),
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
    descriptionEn: z.string().trim().max(300).optional(),
    descriptionAr: z.string().trim().max(300).optional(),
    hours: z.number().positive().max(10_000).optional(),
    perHourMinor: z.number().int().nonnegative().optional(),
    amountMinor: z.number().int().nonnegative().optional(),
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
