import { Conflict, type Result, err, ok } from '@amc/kernel';

/**
 * What a notification is about, and what a person can turn off.
 *
 * The kinds are deliberately few. A list somebody has to read through to find
 * the one setting they want is a list nobody changes, and a preference nobody
 * changes may as well not exist.
 */
export type NotificationKind =
  | 'document_expiring'
  | 'deadline_near'
  | 'task_assigned'
  | 'escalation'
  | 'time_needs_review';

const KINDS: readonly NotificationKind[] = [
  'document_expiring',
  'deadline_near',
  'task_assigned',
  'escalation',
  'time_needs_review',
];

export function isNotificationKind(value: string): value is NotificationKind {
  return (KINDS as readonly string[]).includes(value);
}

export const NOTIFICATION_KINDS = KINDS;

/**
 * What somebody is told by default.
 *
 * In the code rather than the schema, because a default written into a column
 * is one nobody can change without a migration. Email is off except for the
 * two things that cannot wait until somebody next opens the application: a
 * client being chased, and a deadline approaching.
 */
export interface Delivery {
  readonly inApp: boolean;
  readonly email: boolean;
}

const DEFAULTS: Readonly<Record<NotificationKind, Delivery>> = {
  document_expiring: { inApp: true, email: false },
  deadline_near: { inApp: true, email: true },
  task_assigned: { inApp: true, email: false },
  escalation: { inApp: true, email: true },
  time_needs_review: { inApp: true, email: false },
};

export function defaultDelivery(kind: NotificationKind): Delivery {
  return DEFAULTS[kind];
}

/** The words, in both languages, as they were at the time. */
export interface Wording {
  readonly titleEn: string;
  readonly titleAr: string;
  readonly bodyEn: string;
  readonly bodyAr: string;
}

export interface NotificationState {
  readonly id: string;
  readonly userId: string;
  readonly kind: NotificationKind;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly clientId: string | null;
  readonly wording: Wording;
  readonly readAt: Date | null;
  readonly emailedAt: Date | null;
  readonly createdAt: Date;
}

/**
 * Something somebody was told (FR-43).
 *
 * The wording is stored rather than keyed to a translation file. A
 * notification is a record of what a person was told, and if the wording
 * changes next year the row should still say what it said at the time.
 */
export class Notification {
  private constructor(private state: NotificationState) {}

  static rehydrate(state: NotificationState): Notification {
    return new Notification(state);
  }

  static raise(params: {
    id: string;
    userId: string;
    kind: string;
    subjectType: string;
    subjectId: string;
    clientId?: string | null;
    wording: Wording;
    now: Date;
  }): Result<Notification, Conflict> {
    if (!isNotificationKind(params.kind)) {
      return err(new Conflict('That is not something this system tells people about'));
    }
    const { titleEn, titleAr } = params.wording;
    if (titleEn.trim().length === 0 || titleAr.trim().length === 0) {
      return err(new Conflict('A notification needs a title in both languages'));
    }

    return ok(
      new Notification({
        id: params.id,
        userId: params.userId,
        kind: params.kind,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        clientId: params.clientId ?? null,
        wording: params.wording,
        readAt: null,
        emailedAt: null,
        createdAt: params.now,
      }),
    );
  }

  get id(): string {
    return this.state.id;
  }

  get userId(): string {
    return this.state.userId;
  }

  get kind(): NotificationKind {
    return this.state.kind;
  }

  get isRead(): boolean {
    return this.state.readAt !== null;
  }

  /**
   * Marking something read twice is not an error.
   *
   * Two tabs, or a tap that landed twice. Refusing the second would put an
   * error on screen for something that is already true.
   */
  markRead(now: Date): void {
    if (this.state.readAt) return;
    this.state = { ...this.state, readAt: now };
  }

  /** Records that the email went, so a retry does not send it twice. */
  markEmailed(now: Date): void {
    this.state = { ...this.state, emailedAt: now };
  }

  snapshot(): NotificationState {
    return this.state;
  }
}
