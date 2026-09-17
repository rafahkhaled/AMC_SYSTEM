import { z } from 'zod';

export const notificationKinds = [
  'document_expiring',
  'deadline_near',
  'task_assigned',
  'escalation',
  'time_needs_review',
] as const;

/**
 * Both languages, as they were written at the time.
 *
 * Not a translation key: a notification is a record of what somebody was told,
 * and if the wording changes next year the row should still say what it said.
 */
export const notificationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  subjectType: z.string(),
  subjectId: z.string(),
  clientId: z.string().nullable(),
  titleEn: z.string(),
  titleAr: z.string(),
  bodyEn: z.string(),
  bodyAr: z.string(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type NotificationView = z.infer<typeof notificationSchema>;

export const inboxSchema = z.object({
  entries: z.array(notificationSchema),
  unread: z.number().int().nonnegative(),
});
export type Inbox = z.infer<typeof inboxSchema>;

export const preferenceSchema = z.object({
  kind: z.enum(notificationKinds),
  inApp: z.boolean(),
  email: z.boolean(),
});
export type NotificationPreference = z.infer<typeof preferenceSchema>;

export const preferencesSchema = z.object({ preferences: z.array(preferenceSchema) });

export const choosePreferenceSchema = z.object({
  kind: z.enum(notificationKinds),
  inApp: z.boolean(),
  email: z.boolean(),
});
