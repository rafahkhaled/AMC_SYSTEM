import type { Delivery, Notification, NotificationKind } from '../domain/index.js';

export interface NotificationRepository {
  /** Somebody's inbox, newest first. */
  forUser(
    userId: string,
    options?: { limit?: number; unreadOnly?: boolean },
  ): Promise<Notification[]>;
  findById(id: string, userId: string): Promise<Notification | null>;
  /** How many are unread, for the badge on the menu. */
  unreadCount(userId: string): Promise<number>;
  /**
   * Stores it, or does nothing if this person has already been told this.
   * Returns whether it was new, so the caller knows whether to send an email.
   */
  raise(notification: Notification): Promise<boolean>;
  save(notification: Notification): Promise<void>;
  markAllRead(userId: string, now: Date): Promise<number>;
}

export interface PreferenceRepository {
  forUser(userId: string): Promise<Map<NotificationKind, Delivery>>;
  set(userId: string, kind: NotificationKind, delivery: Delivery): Promise<void>;
}

/**
 * Where an email goes.
 *
 * Declared here so this module depends on the idea of sending mail and not on
 * Amazon. The production adapter is SES in me-central-1; development writes to
 * the log, which is how the path gets exercised at all without a mail account.
 */
export interface EmailSender {
  send(message: {
    to: string;
    subject: string;
    body: string;
  }): Promise<void>;
}

/** Somebody's address and the language they read, for an email. */
export interface RecipientReader {
  find(userId: string): Promise<{ email: string; language: 'en' | 'ar' } | null>;
}

/** The caller. Re-exported so modules import their ports, not the kernel. */
export type { CallerLike } from '@amc/kernel';
