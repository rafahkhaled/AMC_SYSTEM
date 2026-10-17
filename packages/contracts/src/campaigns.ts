import { z } from 'zod';

export const campaignStatuses = ['planned', 'active', 'ended'] as const;
export const campaignStatusSchema = z.enum(campaignStatuses);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in the form 2026-03-31');

/** A campaign, with what it has brought in so far. */
export const campaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** A code from the campaign types list in Settings. */
  typeCode: z.string(),
  startsOn: z.string(),
  durationDays: z.number().int().nullable(),
  /** The last day it runs, worked out from the start and the duration. */
  endsOn: z.string().nullable(),
  salespersonId: z.string().nullable(),
  salespersonName: z.string().nullable(),
  notes: z.string().nullable(),
  status: campaignStatusSchema,
  costMinor: z.number().int().nonnegative(),
  currency: z.string(),
  /** Enquiries it brought in. */
  leads: z.number().int().nonnegative(),
  /** Of those, the ones that became clients. */
  clients: z.number().int().nonnegative(),
});
export type CampaignView = z.infer<typeof campaignSchema>;

export const campaignListSchema = z.object({ campaigns: z.array(campaignSchema) });

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1, 'A campaign needs a name').max(120),
  typeCode: z.string().regex(/^[a-z0-9_]{1,40}$/, 'Choose the type of campaign'),
  startsOn: day,
  durationDays: z.number().int().positive().max(3650).optional(),
  salespersonId: z.string().min(1).optional(),
  notes: z.string().trim().max(2000).optional(),
  status: campaignStatusSchema.default('planned'),
  costMinor: z.number().int().nonnegative().default(0),
});
export type CreateCampaignRequest = z.infer<typeof createCampaignSchema>;

/** Only what is sent changes. A field sent as null is cleared. */
export const updateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  typeCode: z
    .string()
    .regex(/^[a-z0-9_]{1,40}$/)
    .optional(),
  startsOn: day.optional(),
  durationDays: z.number().int().positive().max(3650).nullable().optional(),
  salespersonId: z.string().min(1).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  status: campaignStatusSchema.optional(),
  costMinor: z.number().int().nonnegative().optional(),
});
export type UpdateCampaignRequest = z.infer<typeof updateCampaignSchema>;
