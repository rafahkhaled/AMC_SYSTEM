import { z } from 'zod';

export const projectStates = [
  'awaiting_documents',
  'ready',
  'in_progress',
  'waiting_for_client',
  'waiting_for_authority',
  'completed',
  'cancelled',
] as const;
export const projectStateSchema = z.enum(projectStates);
export type ProjectStateName = z.infer<typeof projectStateSchema>;

export const boardProjectSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  service: z.string(),
  periodKey: z.string().nullable(),
  state: projectStateSchema,
  dueAt: z.string().nullable(),
  isOverdue: z.boolean(),
  missingDocuments: z.array(z.string()),
  /** Who is on it. Empty means nobody has picked it up yet. */
  assignees: z.array(z.object({ userId: z.string(), displayName: z.string(), role: z.string() })),
  recordedSeconds: z.number().int().nonnegative(),
});
export type BoardProject = z.infer<typeof boardProjectSchema>;

/**
 * The board, as columns.
 *
 * Grouped by the server rather than by the screen, so the order of the columns
 * and the meaning of each one is decided once. Completed and cancelled work is
 * not on it: a board is what is still to be done.
 */
export const projectBoardSchema = z.object({
  columns: z.array(
    z.object({
      state: projectStateSchema,
      projects: z.array(boardProjectSchema),
    }),
  ),
});
export type ProjectBoard = z.infer<typeof projectBoardSchema>;

export const projectRequirementSchema = z.object({
  type: z.string(),
  mandatory: z.boolean(),
  documentId: z.string().nullable(),
  /** The client document satisfying it, when there is one. */
  documentName: z.string().nullable(),
  documentExpiresOn: z.string().nullable(),
});

/*
 * Both languages, rather than the reader's. Task names come from the service
 * template, not from a translation file, so the server would have to be told
 * which language the person reads in order to choose — and then a language
 * switch would need a round trip to change the words on screen.
 */
export const taskSchema = z.object({
  order: z.number().int(),
  titleEn: z.string(),
  titleAr: z.string(),
  /** When this step should be finished. Null where only the project's date matters. */
  dueOn: z.string().nullable(),
  doneAt: z.string().nullable(),
});

export const projectDetailSchema = boardProjectSchema.extend({
  requirements: z.array(projectRequirementSchema),
  tasks: z.array(taskSchema),
  /** What this project may move to next, decided by the domain's transition table. */
  allowedTransitions: z.array(projectStateSchema),
  /**
   * Of those, the ones that go back, which the server refuses without a
   * reason. Sent rather than worked out in the browser, so the ranking is
   * written down once.
   */
  backwardTransitions: z.array(projectStateSchema),
  /** Documents on the client's file that could satisfy an outstanding requirement. */
  availableDocuments: z.array(
    z.object({ id: z.string(), type: z.string(), expiresOn: z.string().nullable() }),
  ),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

export const moveProjectSchema = z.object({
  to: projectStateSchema,
  /**
   * Required when the work goes backwards, ignored when it goes on.
   *
   * Moving on is routine; moving back is a correction, and "why did this go
   * back to awaiting documents" is a question somebody answers to a client
   * six weeks later.
   */
  reason: z.string().trim().max(300).optional(),
});
export const completeTaskSchema = z.object({ order: z.number().int().nonnegative() });

/** When a step should be finished. Null clears it. */
export const taskDueSchema = z.object({
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});
export const attachDocumentSchema = z.object({
  type: z.string().min(1),
  documentId: z.string().min(1),
});

/** What is on one person's desk. */
export const workloadRowSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  role: z.string(),
  openProjects: z.number().int().nonnegative(),
  overdueProjects: z.number().int().nonnegative(),
  /** Due in the next seven days, which is the week somebody is planning. */
  dueThisWeek: z.number().int().nonnegative(),
  /** Recorded in the last seven days, so the two numbers can be compared. */
  recordedSeconds: z.number().int().nonnegative(),
});
export type WorkloadRow = z.infer<typeof workloadRowSchema>;

export const workloadSchema = z.object({
  people: z.array(workloadRowSchema),
  /** Open work nobody is on. The number a manager acts on first. */
  unassignedProjects: z.number().int().nonnegative(),
});
export type Workload = z.infer<typeof workloadSchema>;

/**
 * The eleven services the firm offers.
 *
 * Declared here so a screen can offer them in a list. The domain keeps its
 * own union — it may not import contracts, because it sees the kernel and
 * itself and nothing else — and `service-code-agreement.test.ts` in the
 * projects module fails if the two ever drift apart.
 */
export const serviceCodes = [
  'ct_registration',
  'vat_registration',
  'vat_return',
  'ct_return',
  'tax_profile_update',
  'deregistration',
  'vat_refund',
  'penalty_waiver',
  'emaratax_request',
  'monthly_accounting',
  'audit',
] as const;
export type ServiceCodeName = (typeof serviceCodes)[number];

/**
 * Starting a piece of work by hand (FR-10).
 *
 * The one-off services — a de-registration, a penalty waiver, a VAT refund —
 * never come from the recurrence sweep, which returns early for a template
 * that happens once. Somebody has to be able to open them.
 */
export const startProjectSchema = z.object({
  clientId: z.string().min(1),
  service: z.string().min(1),
  /** Inclusive calendar day, as the browser's date input writes it. */
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /**
   * The period this covers, for recurring work opened by hand — a VAT return
   * for a quarter the sweep missed. Left out for one-off work, which has no
   * period at all.
   */
  periodKey: z.string().min(1).optional(),
});
export type StartProjectRequest = z.infer<typeof startProjectSchema>;

/* ------------------------------------------------------- the service catalogue */

/**
 * One service the firm offers: one of the eleven in code, or one it added.
 *
 * Sent with both languages' names so a screen never has to ask which language
 * the reader is in, and so a service added today has a label on every screen
 * that shows a project, without a deploy to put it in a translation file.
 */
export const serviceViewSchema = z.object({
  code: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  /** The eleven in code. They cannot be edited or retired from a screen. */
  builtIn: z.boolean(),
  /** Whether the work comes round again. Only ever true for a built-in. */
  recurring: z.boolean(),
  /** Days from starting to due, where it is a fixed number. Null: set by hand. */
  deadlineDays: z.number().int().nullable(),
  steps: z.array(z.object({ nameEn: z.string(), nameAr: z.string() })),
  requiredDocuments: z.array(z.object({ type: z.string(), mandatory: z.boolean() })),
  /** Retired services are not offered for new work but still label old work. */
  retired: z.boolean(),
});
export type ServiceView = z.infer<typeof serviceViewSchema>;
export const servicesSchema = z.object({ services: z.array(serviceViewSchema) });
export type Services = z.infer<typeof servicesSchema>;

const serviceStepSchema = z.object({
  nameEn: z.string().trim().max(120),
  nameAr: z.string().trim().max(120),
});
const serviceDocumentSchema = z.object({
  type: z.string().trim().min(1).max(60),
  mandatory: z.boolean(),
});

/** Adding a service. Always one-off: a recurring one needs a period rule, which is code. */
export const createServiceSchema = z.object({
  nameEn: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().min(1).max(120),
  deadlineDays: z.number().int().min(1).max(730).nullable(),
  steps: z.array(serviceStepSchema).min(1).max(30),
  requiredDocuments: z.array(serviceDocumentSchema).max(30),
});
export type CreateServiceRequest = z.infer<typeof createServiceSchema>;

/**
 * Changing one.
 *
 * Steps may be renamed and added to but not removed or reordered: a project
 * already opened under the service records progress by step number, and
 * deleting step 2 would quietly relabel everything done against step 3.
 */
export const updateServiceSchema = createServiceSchema.partial().extend({
  retired: z.boolean().optional(),
});
export type UpdateServiceRequest = z.infer<typeof updateServiceSchema>;
