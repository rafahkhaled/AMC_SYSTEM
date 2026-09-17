import type { Inbox, NotificationPreference } from '@amc/contracts';
import { type Clock } from '@amc/kernel';
import { NOTIFICATION_KINDS, type NotificationKind, defaultDelivery } from '../domain/index.js';
import type { CallerLike, NotificationRepository, PreferenceRepository } from './ports.js';

/**
 * Whose inbox. Nothing more.
 *
 * There is no permission involved here: everybody has an inbox and nobody has
 * anybody else's, so the caller's own id is the whole of the authorisation.
 * Asking for permissions or a display name would suggest otherwise.
 */
type Owner = Pick<CallerLike, 'userId'>;

/** Somebody's own inbox. There is no reading anybody else's. */
export class ReadInbox {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly preferences: PreferenceRepository,
    private readonly clock: Clock,
  ) {}

  async forCaller(caller: Owner, options: { unreadOnly?: boolean } = {}): Promise<Inbox> {
    const [found, unread] = await Promise.all([
      this.notifications.forUser(caller.userId, {
        limit: 50,
        ...(options.unreadOnly === undefined ? {} : { unreadOnly: options.unreadOnly }),
      }),
      this.notifications.unreadCount(caller.userId),
    ]);

    return {
      entries: found.map((notification) => {
        const state = notification.snapshot();
        return {
          id: state.id,
          kind: state.kind,
          subjectType: state.subjectType,
          subjectId: state.subjectId,
          clientId: state.clientId,
          titleEn: state.wording.titleEn,
          titleAr: state.wording.titleAr,
          bodyEn: state.wording.bodyEn,
          bodyAr: state.wording.bodyAr,
          readAt: state.readAt?.toISOString() ?? null,
          createdAt: state.createdAt.toISOString(),
        };
      }),
      unread,
    };
  }

  /**
   * Every kind, with what this person has chosen or the default.
   *
   * All of them, always. A settings screen that only lists what somebody has
   * already changed is a screen where the untouched settings are invisible.
   */
  async preferencesFor(caller: Owner): Promise<NotificationPreference[]> {
    const chosen = await this.preferences.forUser(caller.userId);
    return NOTIFICATION_KINDS.map((kind) => {
      const delivery = chosen.get(kind) ?? defaultDelivery(kind);
      return { kind, inApp: delivery.inApp, email: delivery.email };
    });
  }

  async markRead(caller: Owner, notificationId: string): Promise<boolean> {
    const notification = await this.notifications.findById(notificationId, caller.userId);
    if (!notification) return false;

    notification.markRead(this.clock.now());
    await this.notifications.save(notification);
    return true;
  }

  async markAllRead(caller: Owner): Promise<number> {
    return this.notifications.markAllRead(caller.userId, this.clock.now());
  }

  async choose(
    caller: Owner,
    kind: NotificationKind,
    delivery: { inApp: boolean; email: boolean },
  ): Promise<NotificationPreference[]> {
    await this.preferences.set(caller.userId, kind, delivery);
    return this.preferencesFor(caller);
  }
}
