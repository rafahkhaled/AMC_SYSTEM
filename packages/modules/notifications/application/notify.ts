import type { Clock, IdGenerator } from '@amc/kernel';
import {
  Notification,
  type NotificationKind,
  type Wording,
  defaultDelivery,
} from '../domain/index.js';
import type {
  EmailSender,
  NotificationRepository,
  PreferenceRepository,
  RecipientReader,
} from './ports.js';

export interface NotifyCommand {
  readonly userId: string;
  readonly kind: NotificationKind;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly clientId?: string | null;
  readonly wording: Wording;
}

/**
 * Telling somebody something (FR-43).
 *
 * The escalation ladder already decides who and when; this is the telling. It
 * is idempotent by the same means the ladder is — one notification per person
 * per thing, enforced in the database — so a sweep can run twice in a morning
 * and nobody is told twice.
 *
 * An email is sent only when the notification is new. A failed email does not
 * undo the notification: the inbox entry is the record that somebody was told,
 * and losing it because a mail server was down would be the worse failure.
 */
export class Notify {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly preferences: PreferenceRepository,
    private readonly recipients: RecipientReader,
    private readonly email: EmailSender,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async send(command: NotifyCommand): Promise<'sent' | 'already_told' | 'not_wanted'> {
    const wanted =
      (await this.preferences.forUser(command.userId)).get(command.kind) ??
      defaultDelivery(command.kind);

    // Somebody who wants neither is told nothing at all, rather than having an
    // inbox quietly fill with things they asked not to see.
    if (!wanted.inApp && !wanted.email) return 'not_wanted';

    const now = this.clock.now();
    const notification = Notification.raise({
      id: this.ids.next(),
      userId: command.userId,
      kind: command.kind,
      subjectType: command.subjectType,
      subjectId: command.subjectId,
      ...(command.clientId === undefined ? {} : { clientId: command.clientId }),
      wording: command.wording,
      now,
    });
    if (!notification.ok) return 'not_wanted';

    const isNew = await this.notifications.raise(notification.value);
    if (!isNew) return 'already_told';

    if (wanted.email) await this.emailIt(notification.value, command);
    return 'sent';
  }

  /**
   * Sends the email, in the language the person reads.
   *
   * A failure here is swallowed on purpose. The notification is already
   * stored, which is the record that somebody was told; throwing would roll
   * the caller back and lose that over a mail server being briefly down.
   */
  private async emailIt(notification: Notification, command: NotifyCommand): Promise<void> {
    try {
      const recipient = await this.recipients.find(command.userId);
      if (!recipient) return;

      const arabic = recipient.language === 'ar';
      await this.email.send({
        to: recipient.email,
        subject: arabic ? command.wording.titleAr : command.wording.titleEn,
        body: arabic ? command.wording.bodyAr : command.wording.bodyEn,
      });

      notification.markEmailed(this.clock.now());
      await this.notifications.save(notification);
    } catch {
      // Left unsent. `emailed_at` stays null, which is what a later sweep
      // would look at if one is ever added.
    }
  }
}
