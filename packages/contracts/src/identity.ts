import { z } from 'zod';

/**
 * The shapes the API and the browser agree on. Both import this file, so a
 * change to a field breaks the build on both sides at once rather than
 * surfacing as a runtime surprise in someone's browser.
 */

export const roleSchema = z.enum(['manager', 'accountant', 'data_entry', 'client']);
export type RoleName = z.infer<typeof roleSchema>;

export const signInRequestSchema = z.object({
  email: z.string().trim().min(1, 'An email address is required').max(254),
  // Not validated for shape here. Rules belong to registration; at sign-in the
  // only question is whether it matches, and an extra rule would only hint at
  // what the stored password looks like.
  password: z.string().min(1, 'A password is required').max(256),
});
export type SignInRequest = z.infer<typeof signInRequestSchema>;

export const callerSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  roles: z.array(roleSchema),
  permissions: z.array(z.string()),
});
export type Caller = z.infer<typeof callerSchema>;

export const signInResponseSchema = z.object({
  caller: callerSchema,
  /** When this session lapses if it is not used again. */
  expiresAt: z.string().datetime(),
  twoFactorRequired: z.boolean(),
});
export type SignInResponse = z.infer<typeof signInResponseSchema>;

export const twoFactorCodeSchema = z.object({
  // Spaces allowed: authenticator apps display "123 456" and people copy it.
  code: z.string().trim().min(6).max(10),
});
export type TwoFactorCodeRequest = z.infer<typeof twoFactorCodeSchema>;

export const twoFactorEnrolmentSchema = z.object({
  /** Shown as a QR code, and in text for anyone typing it by hand. */
  secret: z.string(),
  uri: z.string(),
});
export type TwoFactorEnrolment = z.infer<typeof twoFactorEnrolmentSchema>;

/** The cookie the browser never reads, because it cannot. */
export const SESSION_COOKIE = 'amc_session';
