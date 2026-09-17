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

export const contactChannels = ['call', 'whatsapp', 'email', 'meeting', 'portal', 'other'] as const;

export const contactLogEntrySchema = z.object({
  id: z.string(),
  channel: z.enum(contactChannels),
  direction: z.enum(['inbound', 'outbound']),
  happenedAt: z.string(),
  summary: z.string(),
  taskId: z.string().nullable(),
  attachments: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      contentType: z.string(),
      sizeBytes: z.number().int().nonnegative(),
    }),
  ),
});
export type ContactLogEntryView = z.infer<typeof contactLogEntrySchema>;

export const recordContactSchema = z.object({
  channel: z.enum(contactChannels),
  direction: z.enum(['inbound', 'outbound']),
  /**
   * When the conversation happened, which is not when it was typed up. A call
   * on Tuesday written up on Thursday is a call on Tuesday, and the chase
   * counts days from the former.
   */
  happenedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use a date and a time'),
  summary: z.string().trim().min(3, 'Say what the conversation was about'),
  taskId: z.string().optional(),
  contactId: z.string().optional(),
});

export const leadStatuses = ['new', 'contacted', 'quoted', 'confirmed', 'declined'] as const;
export const leadSources = [
  'whatsapp',
  'phone',
  'referral',
  'advertisement',
  'walk_in',
  'other',
] as const;

export const leadSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  source: z.enum(leadSources),
  sourceDetail: z.string().nullable(),
  requestedService: z.string().nullable(),
  status: z.enum(leadStatuses),
  convertedClientId: z.string().nullable(),
  receivedAt: z.string(),
  notes: z.string().nullable(),
  /** What this enquiry may move to next, from the domain's own table. */
  allowedNext: z.array(z.enum(leadStatuses)),
  /** How long it has been sitting, which is the number that matters. */
  waitingDays: z.number().int().nonnegative(),
});
export type LeadView = z.infer<typeof leadSchema>;

/** The pipeline, as columns. Order and membership decided by the server. */
export const leadBoardSchema = z.object({
  columns: z.array(z.object({ status: z.enum(leadStatuses), leads: z.array(leadSchema) })),
});
export type LeadBoard = z.infer<typeof leadBoardSchema>;

export const captureLeadSchema = z
  .object({
    name: z.string().trim().min(1, 'An enquiry needs a name'),
    phone: z.string().trim().optional(),
    email: z.string().trim().optional(),
    source: z.enum(leadSources),
    sourceDetail: z.string().trim().max(200).optional(),
    requestedService: z.string().trim().max(200).optional(),
  })
  .refine((lead) => Boolean(lead.phone || lead.email), {
    message: 'An enquiry needs a phone number or an email address',
    path: ['phone'],
  });

export const moveLeadSchema = z.object({
  to: z.enum(leadStatuses),
  note: z.string().trim().max(500).optional(),
});

export const convertLeadSchema = z.object({
  legalName: z.string().trim().min(1, 'The client needs a legal name'),
});

export const letterTemplateSchema = z.object({
  code: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  /** Which facts this letter needs, so a preview can say what is missing. */
  needs: z.array(z.string()),
});
export type LetterTemplate = z.infer<typeof letterTemplateSchema>;

export const letterSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  language: z.enum(['en', 'ar']),
  createdAt: z.string(),
  /**
   * Facts the letter wanted and the client record could not supply. Returned
   * rather than refused: a letter with a gap is often exactly what somebody
   * wants, and refusing would send them back to a Word file.
   */
  missing: z.array(z.string()),
});
export type Letter = z.infer<typeof letterSchema>;

export const generateLetterSchema = z.object({
  templateCode: z.string().min(1),
  language: z.enum(['en', 'ar']),
  taskId: z.string().optional(),
});
