import {
  type Inbox,
  type NotificationPreference,
  inboxSchema,
  preferencesSchema,
} from '@amc/contracts';
import { request, send } from '../auth/api.js';

export async function inbox(unreadOnly = false): Promise<Inbox> {
  return inboxSchema.parse(await request(`/notifications${unreadOnly ? '?unread=true' : ''}`));
}

export async function markRead(id: string): Promise<Inbox> {
  return inboxSchema.parse(await send(`/notifications/${encodeURIComponent(id)}/read`));
}

export async function markAllRead(): Promise<Inbox> {
  return inboxSchema.parse(await send('/notifications/read-all'));
}

export async function preferences(): Promise<NotificationPreference[]> {
  return preferencesSchema.parse(await request('/notifications/preferences')).preferences;
}

export async function choosePreference(
  preference: NotificationPreference,
): Promise<NotificationPreference[]> {
  const response = await fetch('/api/notifications/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(preference),
  });
  if (!response.ok) throw new Error('That setting did not save');
  return preferencesSchema.parse(await response.json()).preferences;
}
