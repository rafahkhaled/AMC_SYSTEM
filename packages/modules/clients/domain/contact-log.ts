import { Conflict, type Result, err, ok } from '@amc/kernel';

/** How the practice spoke to the client. */
export type ContactChannel = 'call' | 'whatsapp' | 'email' | 'meeting' | 'portal' | 'other';
export type ContactDirection = 'inbound' | 'outbound';

const CHANNELS: readonly ContactChannel[] = [
  'call',
  'whatsapp',
  'email',
  'meeting',
  'portal',
  'other',
];

export function isContactChannel(value: string): value is ContactChannel {
  return (CHANNELS as readonly string[]).includes(value);
}

export interface ContactAttachment {
  readonly id: string;
  readonly storageKey: string;
  readonly originalName: string;
  readonly contentType: string;
  readonly checksum: string;
  readonly sizeBytes: number;
}

export interface ContactLogState {
  readonly id: string;
  readonly clientId: string;
  readonly contactId: string | null;
  readonly userId: string | null;
  readonly channel: ContactChannel;
  readonly direction: ContactDirection;
  readonly happenedAt: Date;
  readonly summary: string;
  readonly taskId: string | null;
  readonly attachments: readonly ContactAttachment[];
  readonly createdAt: Date;
}

/**
 * One conversation with a client (FR-06).
 *
 * The time it happened is separate from the time it was typed up, because a
 * call on Tuesday written up on Thursday is a call on Tuesday — and the
 * escalation ladder counts days from when the client was actually asked.
 */
export class ContactLogEntry {
  private constructor(private state: ContactLogState) {}

  static rehydrate(state: ContactLogState): ContactLogEntry {
    return new ContactLogEntry(state);
  }

  static record(params: {
    id: string;
    clientId: string;
    contactId?: string | null;
    userId: string;
    channel: string;
    direction: string;
    happenedAt: Date;
    summary: string;
    taskId?: string | null;
    now: Date;
  }): Result<ContactLogEntry, Conflict> {
    if (!isContactChannel(params.channel)) {
      return err(new Conflict('That is not a way of contacting somebody this system records'));
    }
    if (params.direction !== 'inbound' && params.direction !== 'outbound') {
      return err(new Conflict('Say whether the client was contacted or made contact'));
    }

    const summary = params.summary.trim();
    if (summary.length < 3) {
      return err(new Conflict('Say what the conversation was about'));
    }

    /*
     * A conversation cannot have happened tomorrow. Without this a mistyped
     * year sits in the log unnoticed and quietly moves a chase forward, since
     * the escalation ladder counts from this date.
     */
    if (params.happenedAt.getTime() > params.now.getTime()) {
      return err(new Conflict('That conversation has not happened yet'));
    }

    return ok(
      new ContactLogEntry({
        id: params.id,
        clientId: params.clientId,
        contactId: params.contactId ?? null,
        userId: params.userId,
        channel: params.channel,
        direction: params.direction,
        happenedAt: params.happenedAt,
        summary,
        taskId: params.taskId ?? null,
        attachments: [],
        createdAt: params.now,
      }),
    );
  }

  get id(): string {
    return this.state.id;
  }

  get clientId(): string {
    return this.state.clientId;
  }

  /** A screenshot of the thread, which is what makes "we asked" provable. */
  attach(attachment: ContactAttachment): void {
    this.state = { ...this.state, attachments: [...this.state.attachments, attachment] };
  }

  snapshot(): ContactLogState {
    return this.state;
  }
}
