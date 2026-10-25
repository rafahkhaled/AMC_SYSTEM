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
      /** Days with their own hours, keyed by weekday ("6" is Saturday). */
      dayHours: z
        .record(z.string(), z.object({ startsAt: z.string(), endsAt: z.string() }))
        .default({}),
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

/** The roles the firm has (FR-03). Kept beside the directory that offers them. */
export const staffRoles = ['manager', 'accountant', 'data_entry', 'client'] as const;
export type StaffRole = (typeof staffRoles)[number];

/**
 * Adding a colleague (FR-03).
 *
 * The initial password is set by whoever adds the person and is expected to
 * be changed by them. There is no invitation email yet, and pretending
 * otherwise would leave an account nobody can get into.
 */
export const addStaffSchema = z.object({
  email: z.string().email(),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(12),
  roles: z.array(z.enum(staffRoles)).min(1),
});
export type AddStaffRequest = z.infer<typeof addStaffSchema>;

/** Correcting a colleague's record. Anything left out is left alone. */
export const updateStaffSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  roles: z.array(z.enum(staffRoles)).min(1).optional(),
  /** When they work, which is what "after hours" is measured against. */
  workingHours: z
    .object({
      startsAt: z.string().regex(/^\d{2}:\d{2}$/),
      endsAt: z.string().regex(/^\d{2}:\d{2}$/),
      /** ISO weekday numbers: 1 is Monday. */
      days: z.array(z.number().int().min(1).max(7)).min(1),
      dayHours: z
        .record(
          z.string().regex(/^[1-7]$/),
          z.object({
            startsAt: z.string().regex(/^\d{2}:\d{2}$/),
            endsAt: z.string().regex(/^\d{2}:\d{2}$/),
          }),
        )
        .optional(),
    })
    .optional(),
});
export type UpdateStaffRequest = z.infer<typeof updateStaffSchema>;

export const staffStatusSchema = z.object({ status: z.enum(['active', 'suspended']) });
export type StaffStatusRequest = z.infer<typeof staffStatusSchema>;

/** Asking for a link to choose a new password. */
export const forgotPasswordSchema = z.object({
  email: z.string().trim().min(1, 'An email address is required').max(254),
});

/** Using that link. The rules for the password are the same as at registration. */
export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(1, 'Choose a new password').max(256),
});

/** A manager choosing a new password for a colleague. */
export const setStaffPasswordSchema = z.object({
  password: z.string().min(1, 'Choose a new password').max(256),
});

/** What each role may do, and what the firm may change. */
export const rolePermissionsSchema = z.object({
  roles: z.array(
    z.object({
      role: roleSchema,
      /** False for the manager: what a manager may do is fixed. */
      editable: z.boolean(),
      permissions: z.array(z.string()),
      /** What the role had before the firm changed anything, for "put it back". */
      defaults: z.array(z.string()),
    }),
  ),
  /** Every permission that has a tick box. */
  grantable: z.array(z.string()),
});
export type RolePermissions = z.infer<typeof rolePermissionsSchema>;

export const chooseRolePermissionsSchema = z.object({
  permissions: z.array(z.string().max(60)).max(60),
});
