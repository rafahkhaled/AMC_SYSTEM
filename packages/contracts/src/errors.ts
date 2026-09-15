import { z } from 'zod';

/**
 * Every failure the API returns has this shape, so the browser has exactly one
 * thing to parse and one place to decide what to show a person.
 */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).default({}),
    requestId: z.string().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
