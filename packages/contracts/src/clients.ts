import { z } from 'zod';

/** The shapes the clients screens and the API agree on. */

export const clientStatusSchema = z.enum(['active', 'dormant', 'closed']);
export const registrationStateSchema = z.enum(['not_registered', 'registered', 'deregistered']);

export const clientSummarySchema = z.object({
  id: z.string(),
  legalName: z.string(),
  legalNameArabic: z.string().nullable(),
  status: clientStatusSchema,
  vatState: registrationStateSchema,
  vatTrn: z.string().nullable(),
  ctState: registrationStateSchema,
  /** How many of this client's documents need attention, for the list. */
  documentsExpiring: z.number().int().nonnegative(),
  openTasks: z.number().int().nonnegative(),
});
export type ClientSummary = z.infer<typeof clientSummarySchema>;

export const documentSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.enum(['required', 'held', 'renewing']),
  expiresOn: z.string().nullable(),
  /** never_expires, valid, expiring, expired — computed, never stored. */
  expiryState: z.enum(['never_expires', 'valid', 'expiring', 'expired']),
  daysUntilExpiry: z.number().int().nullable(),
  originalName: z.string().nullable(),
});
export type DocumentSummary = z.infer<typeof documentSummarySchema>;

export const taskSummarySchema = z.object({
  id: z.string(),
  service: z.string(),
  periodKey: z.string().nullable(),
  state: z.string(),
  dueAt: z.string().nullable(),
  missingDocuments: z.array(z.string()),
  isOverdue: z.boolean(),
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;

export const rateChangeSchema = z.object({
  perHour: z.string(),
  currency: z.string(),
  effectiveFrom: z.string(),
  note: z.string().nullable(),
});

export const clientDetailSchema = clientSummarySchema.extend({
  tradeLicenceNumber: z.string().nullable(),
  ctTrn: z.string().nullable(),
  /** Which months this client's VAT periods end in. Staggered per client. */
  vatPeriodEndMonths: z.array(z.number().int()),
  financialYearEndMonth: z.number().int().nullable(),
  currentRate: z.string().nullable(),
  rateHistory: z.array(rateChangeSchema),
  documents: z.array(documentSummarySchema),
  tasks: z.array(taskSummarySchema),
});
export type ClientDetail = z.infer<typeof clientDetailSchema>;

export const clientListSchema = z.object({ clients: z.array(clientSummarySchema) });
