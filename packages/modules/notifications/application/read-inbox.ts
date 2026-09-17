import type { Clock } from '@amc/kernel';
import { NOTIFICATION_KINDS, type NotificationKind, defaultDelivery } from '../domain/index.js';
import type { CallerLike, NotificationRepository, PreferenceRepository } from './ports.js';

export interface InboxEntry {
  readonly id: string;
  readonly kind: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly clientId: string | null;
  readonly titleEn: string;
  readonly titleAr: string;
  readonly bodyEn: string;
  readonly bodyAr: string;
  readonly readAt: string | null;
  readonly createdAt: string;
}

export interface Inbox {
  readonly entries: InboxEntry[];
  readonly unread: number;
}

export interface PreferenceView {
  readonly kind: string;
  readonly inApp: boolean;
  readonly email: boolean;
}

/** Somebody's own inbox. There is no reading anybody else's. */
export class ReadInbox {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly preferences: PreferenceRepository,
    private readonly clock: Clock,
  ) {}

  async forCaller(caller: CallerLike, options: { unreadOnly?: boolean } = {}): Promise<Inbox> {
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
  async preferencesFor(caller: CallerLike): Promise<PreferenceView[]> {
    const chosen = await this.preferences.forUser(caller.userId);
    return NOTIFICATION_KINDS.map((kind) => {
      const delivery = chosen.get(kind) ?? defaultDelivery(kind);
      return { kind, inApp: delivery.inApp, email: delivery.email };
    });
  }

  async markRead(caller: CallerLike, notificationId: string): Promise<boolean> {
    const notification = await this.notifications.findById(notificationId, caller.userId);
    if (!notification) return false;

    notification.markRead(this.clock.now());
    await this.notifications.save(notification);
    return true;
  }

  async markAllRead(caller: CallerLike): Promise<number> {
    return this.notifications.markAllRead(caller.userId, this.clock.now());
  }

  async choose(
    caller: CallerLike,
    kind: NotificationKind,
    delivery: { inApp: boolean; email: boolean },
  ): Promise<PreferenceView[]> {
    await this.preferences.set(caller.userId, kind, delivery);
    return this.preferencesFor(caller);
  }
}
