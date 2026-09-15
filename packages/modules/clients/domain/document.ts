import { AggregateRoot, Conflict, type Result, domainEvent, err, ok } from '@amc/kernel';

export type DocumentId = string;

/**
 * The documents a practice actually chases (FR-04).
 *
 * A code rather than free text, because the deadline engine asks "which
 * clients have a trade licence expiring in sixty days" and free text would
 * make that a guess.
 */
export type DocumentTypeCode =
  | 'trade_licence'
  | 'emirates_id'
  | 'passport'
  | 'visa'
  | 'memorandum'
  | 'tenancy_contract'
  | 'vat_certificate'
  | 'corporate_tax_certificate'
  | 'bank_letter'
  | 'other';

/** Which of those carry an expiry date and therefore need chasing. */
export const EXPIRES: Readonly<Record<DocumentTypeCode, boolean>> = {
  trade_licence: true,
  emirates_id: true,
  passport: true,
  visa: true,
  tenancy_contract: true,
  memorandum: false,
  vat_certificate: false,
  corporate_tax_certificate: false,
  bank_letter: false,
  other: false,
};

/**
 * Where a document is in the practice's workflow.
 *
 * Deliberately not including "expired". Expiry is a fact about a date, and
 * storing it as a state means something has to run nightly to flip it, which
 * means there is a window where the database says valid and the calendar says
 * otherwise. Asking the date is always right and never needs a job.
 */
export type DocumentStatus = 'required' | 'held' | 'renewing';

/** What the date says, which is a different question from the workflow. */
export type ExpiryState = 'never_expires' | 'valid' | 'expiring' | 'expired';

/** The staged warnings from FR-42, in the order they fire. */
export const EXPIRY_WARNING_DAYS = [90, 60, 30] as const;

export interface DocumentState {
  readonly id: DocumentId;
  readonly clientId: string;
  readonly type: DocumentTypeCode;
  readonly label: string | null;
  readonly status: DocumentStatus;
  readonly storageKey: string | null;
  readonly originalName: string | null;
  readonly checksum: string | null;
  readonly issuedOn: Date | null;
  readonly expiresOn: Date | null;
  readonly supersededById: DocumentId | null;
  readonly uploadedBy: string | null;
  readonly uploadedAt: Date | null;
  readonly requestedAt: Date;
}

export class ClientDocument extends AggregateRoot<DocumentId> {
  private constructor(private state: DocumentState) {
    super(state.id);
  }

  static rehydrate(state: DocumentState): ClientDocument {
    return new ClientDocument(state);
  }

  /**
   * Note that a document is needed before it arrives.
   *
   * This is what makes a checklist possible: the row exists as soon as the
   * service is subscribed to, so a task can see what is missing rather than
   * inferring it from the absence of something.
   */
  static require(params: {
    id: DocumentId;
    clientId: string;
    type: DocumentTypeCode;
    label?: string | null;
    now: Date;
  }): ClientDocument {
    const document = new ClientDocument({
      id: params.id,
      clientId: params.clientId,
      type: params.type,
      label: params.label?.trim() || null,
      status: 'required',
      storageKey: null,
      originalName: null,
      checksum: null,
      issuedOn: null,
      expiresOn: null,
      supersededById: null,
      uploadedBy: null,
      uploadedAt: null,
      requestedAt: params.now,
    });
    document.record(
      domainEvent('clients.document.required', params.id, params.now, {
        documentId: params.id,
        clientId: params.clientId,
        type: params.type,
      }),
    );
    return document;
  }

  get clientId(): string {
    return this.state.clientId;
  }

  get type(): DocumentTypeCode {
    return this.state.type;
  }

  get status(): DocumentStatus {
    return this.state.status;
  }

  get storageKey(): string | null {
    return this.state.storageKey;
  }

  get expiresOn(): Date | null {
    return this.state.expiresOn;
  }

  get isSuperseded(): boolean {
    return this.state.supersededById !== null;
  }

  /**
   * Record that the document arrived.
   *
   * A type that expires must be given an expiry date. Accepting a trade
   * licence with no expiry would quietly remove that client from every
   * renewal reminder, which is the failure this system exists to prevent.
   */
  receive(params: {
    storageKey: string;
    originalName: string;
    checksum: string;
    issuedOn?: Date | null;
    expiresOn?: Date | null;
    uploadedBy: string;
    now: Date;
  }): Result<true, Conflict> {
    if (this.isSuperseded) {
      return err(new Conflict('This document has been replaced by a newer one'));
    }
    if (EXPIRES[this.state.type] && !params.expiresOn) {
      return err(
        new Conflict('A document of this type needs an expiry date', { type: this.state.type }),
      );
    }
    if (params.issuedOn && params.expiresOn && params.expiresOn <= params.issuedOn) {
      return err(new Conflict('An expiry date must come after the issue date'));
    }

    this.state = {
      ...this.state,
      status: 'held',
      storageKey: params.storageKey,
      originalName: params.originalName,
      checksum: params.checksum,
      issuedOn: params.issuedOn ?? null,
      expiresOn: params.expiresOn ?? null,
      uploadedBy: params.uploadedBy,
      uploadedAt: params.now,
    };

    this.record(
      domainEvent('clients.document.received', this.id, params.now, {
        documentId: this.id,
        clientId: this.state.clientId,
        type: this.state.type,
        expiresOn: params.expiresOn?.toISOString() ?? null,
      }),
    );
    return ok(true);
  }

  /** Mark that a renewal is under way, so the chasing stops for now. */
  markRenewing(now: Date): Result<true, Conflict> {
    if (this.state.status !== 'held') {
      return err(new Conflict('Only a document we hold can be under renewal'));
    }
    this.state = { ...this.state, status: 'renewing' };
    this.record(
      domainEvent('clients.document.renewing', this.id, now, {
        documentId: this.id,
        clientId: this.state.clientId,
        type: this.state.type,
      }),
    );
    return ok(true);
  }

  /**
   * Replace this document with a newer version.
   *
   * The old one is kept rather than overwritten, because a task completed in
   * March used the licence that was valid in March, and the file behind that
   * work must still be the file that was used.
   */
  supersede(newerId: DocumentId, now: Date): Result<true, Conflict> {
    if (this.isSuperseded) return err(new Conflict('This document has already been replaced'));
    this.state = { ...this.state, supersededById: newerId };
    this.record(
      domainEvent('clients.document.superseded', this.id, now, {
        documentId: this.id,
        replacedBy: newerId,
        clientId: this.state.clientId,
      }),
    );
    return ok(true);
  }

  /**
   * What the calendar says about this document on a given day.
   *
   * Computed, never stored. A stored flag needs something to run nightly to
   * keep it true, and between runs the database and the calendar disagree.
   */
  expiryStateOn(today: Date): ExpiryState {
    if (!this.state.expiresOn) return 'never_expires';
    const days = this.daysUntilExpiry(today);
    if (days === null) return 'never_expires';
    if (days < 0) return 'expired';
    return days <= EXPIRY_WARNING_DAYS[0] ? 'expiring' : 'valid';
  }

  /** Whole days, counted on calendar dates rather than elapsed hours. */
  daysUntilExpiry(today: Date): number | null {
    if (!this.state.expiresOn) return null;
    const startOfDay = (value: Date) =>
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
    return Math.round((startOfDay(this.state.expiresOn) - startOfDay(today)) / 86_400_000);
  }

  /**
   * Which staged warning is due today, or null.
   *
   * It fires on the day the threshold is crossed rather than on every day
   * after, so a client gets three reminders over three months instead of
   * ninety and learning to ignore all of them.
   */
  warningDueOn(today: Date): number | null {
    if (this.state.status === 'renewing') return null;
    const days = this.daysUntilExpiry(today);
    if (days === null) return null;
    return EXPIRY_WARNING_DAYS.find((threshold) => threshold === days) ?? null;
  }

  snapshot(): DocumentState {
    return this.state;
  }
}
