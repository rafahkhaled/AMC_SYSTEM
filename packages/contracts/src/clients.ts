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

/** A date the person typed, not an instant. Kept as a plain calendar day. */
const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in the form 2026-03-31');

export const documentUploadSchema = z.object({
  type: z.string().min(1),
  label: z.string().trim().max(200).optional(),
  issuedOn: calendarDay.optional(),
  expiresOn: calendarDay.optional(),
  /** Set when replacing a document already on file, which supersedes it. */
  replacesId: z.string().optional(),
});
export type DocumentUploadRequest = z.infer<typeof documentUploadSchema>;

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

export const credentialKinds = ['emaratax', 'ftaportal', 'bank_portal', 'other'] as const;

/** A stored login, with the password still sealed. */
export const credentialSummarySchema = z.object({
  id: z.string(),
  kind: z.string(),
  username: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type CredentialSummary = z.infer<typeof credentialSummarySchema>;

export const storeCredentialSchema = z.object({
  kind: z.enum(credentialKinds),
  username: z.string().trim().min(1, 'The portal needs a username'),
  secret: z.string().min(1, 'The portal needs a password'),
  note: z.string().trim().max(500).optional(),
});

/**
 * Reading a password requires saying why.
 *
 * The reason goes in the audit log. Without it the log records that somebody
 * looked, which an auditor could have guessed; with it the log answers the
 * question they are actually asking.
 */
export const revealCredentialSchema = z.object({
  reason: z.string().trim().min(3, 'Say why the password is needed'),
});

export const revealedCredentialSchema = z.object({
  username: z.string(),
  secret: z.string(),
});
export type RevealedCredential = z.infer<typeof revealedCredentialSchema>;
