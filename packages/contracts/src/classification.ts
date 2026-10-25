import { z } from 'zod';

/** Somebody who sold work: an employee, or a name added for an outside agent. */
export const salespersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Set for an employee. */
  userId: z.string().nullable(),
  retired: z.boolean(),
});
export type Salesperson = z.infer<typeof salespersonSchema>;
export const salespeopleSchema = z.object({ salespeople: z.array(salespersonSchema) });

export const addSalespersonSchema = z.object({
  name: z.string().trim().min(1, 'Give the salesperson’s name').max(120),
});

/** What can be classified, from the first enquiry to the invoice. */
export const classifiedEntities = ['client', 'lead', 'quotation', 'project', 'invoice'] as const;
export type ClassifiedEntity = (typeof classifiedEntities)[number];

/** Branch, salesperson and who did the work, on one record. */
export const classificationSchema = z.object({
  branchCode: z.string().nullable(),
  salespersonId: z.string().nullable(),
  /** The employee who did (or is doing) the work. On a job, its responsible person. */
  performedBy: z.string().nullable(),
  /** Whether the branch can be changed here. Fixed on an issued invoice, and set elsewhere on a quotation. */
  branchEditable: z.boolean(),
  /** Whether "who did the work" is set here or, on a job, from its team. */
  performerEditable: z.boolean(),
});
export type Classification = z.infer<typeof classificationSchema>;

/** Only what is sent changes. Null clears it. */
export const updateClassificationSchema = z.object({
  branchCode: z.string().min(1).nullable().optional(),
  salespersonId: z.string().min(1).nullable().optional(),
  performedBy: z.string().min(1).nullable().optional(),
});
export type UpdateClassification = z.infer<typeof updateClassificationSchema>;

const row = z.object({
  /** The branch code, salesperson id or user id; null for "not set". */
  key: z.string().nullable(),
  name: z.string().nullable(),
  clients: z.number().int(),
  quotations: z.number().int(),
  projects: z.number().int(),
  invoices: z.number().int(),
  /** Invoiced in the period, before VAT, in fils. */
  invoicedMinor: z.number().int(),
});
export type ClassificationRow = z.infer<typeof row>;

export const classificationReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  byBranch: z.array(row),
  bySalesperson: z.array(row),
  byPerformer: z.array(row),
});
export type ClassificationReport = z.infer<typeof classificationReportSchema>;
