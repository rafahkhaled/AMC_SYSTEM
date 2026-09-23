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

/**
 * The staff directory (X-01).
 *
 * One row per person, answering "what is this person doing this week" without
 * opening four screens. Scoped by role: everybody sees who works here and
 * when they work, and only somebody who manages people sees the hours.
 *
 * Not here, because the system does not hold it: leave, and the expiry of a
 * member of staff's own documents. Both were asked for. Inventing empty
 * columns for them would suggest the data is coming.
 */
export const staffMemberSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string(),
  roles: z.array(z.string()),
  status: z.string(),
  /** When this person works, which is what "after hours" is measured against. */
  workingHours: z
    .object({
      startsAt: z.string(),
      endsAt: z.string(),
      /** ISO weekday numbers: 1 is Monday. */
      days: z.array(z.number().int()),
    })
    .nullable(),
  clients: z.number().int().nonnegative(),
  openProjects: z.number().int().nonnegative(),
  overdueProjects: z.number().int().nonnegative(),
  /**
   * Null for anybody who may not see other people's hours, rather than zero:
   * a nought is a claim about the person, and absence is a claim about the
   * reader.
   */
  thisMonthSeconds: z.number().int().nonnegative().nullable(),
  lastMonthSeconds: z.number().int().nonnegative().nullable(),
});
export type StaffMember = z.infer<typeof staffMemberSchema>;

export const staffDirectorySchema = z.object({ staff: z.array(staffMemberSchema) });
export type StaffDirectory = z.infer<typeof staffDirectorySchema>;
