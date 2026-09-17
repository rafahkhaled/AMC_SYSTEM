import { AggregateRoot, Conflict, Duration, type Result, domainEvent, err, ok } from '@amc/kernel';

export type TimeEntryId = string;

/** Where the record came from, which changes how much it is trusted. */
export type TimeSource = 'timer' | 'manual';

/**
 * Why an entry is in doubt (FR-25).
 *
 * `after_hours` is a span that fell outside the person's working day.
 * `abandoned` is a timer that stopped sending heartbeats and was trimmed back.
 * `implausible` is simply too long to be one sitting.
 *
 * None of them means the time is wrong. They mean nobody can tell from the
 * outside, which is why the answer is a question put to the person who was
 * there rather than a rule that silently keeps or discards it.
 */
export type ReviewReason = 'after_hours' | 'abandoned' | 'implausible';

export interface TimeEntryState {
  readonly id: TimeEntryId;
  /**
   * The assignment, not the task and not the person.
   *
   * Client, task and staff member are all reached through it, which is what
   * keeps reassignment from rewriting who did last month's work. FR-20 is
   * still satisfied: all three are mandatory and all three are derivable.
   */
  readonly assignmentId: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly source: TimeSource;
  /** Required for a manual entry, so the audit trail says why (FR-22). */
  readonly reason: string | null;
  readonly billable: boolean;
  readonly note: string | null;
  /**
   * Why this entry is waiting to be looked at, or null if nothing is in doubt.
   *
   * A flagged entry is still a real entry: it counts on a timesheet and its
   * owner can see it. What it cannot do is reach a client statement without
   * somebody confirming it.
   */
  readonly reviewReason: ReviewReason | null;
  readonly reviewedAt: Date | null;
  readonly reviewedBy: string | null;
  readonly approvedAt: Date | null;
  readonly approvedBy: string | null;
  /**
   * Set when the entry is included in a statement line. From that moment the
   * entry is read-only (FR-26).
   */
  readonly statementLineId: string | null;
}

/** The longest a single sitting can plausibly be (FR-25). */
export const IMPLAUSIBLE_HOURS = 12;

export class TimeEntry extends AggregateRoot<TimeEntryId> {
  private constructor(private state: TimeEntryState) {
    super(state.id);
  }

  static rehydrate(state: TimeEntryState): TimeEntry {
    return new TimeEntry(state);
  }

  /** A completed stretch of work, recorded by the timer. */
  static fromTimer(params: {
    id: TimeEntryId;
    assignmentId: string;
    startedAt: Date;
    endedAt: Date;
    billable?: boolean;
    note?: string | null;
    /** Why this span is in doubt, if it is. Decided by the caller (FR-25). */
    reviewReason?: ReviewReason | null;
  }): Result<TimeEntry, Conflict> {
    const length = Duration.tryBetween(params.startedAt, params.endedAt);
    if (!length.ok) return err(new Conflict(length.error.message));

    const entry = new TimeEntry({
      id: params.id,
      assignmentId: params.assignmentId,
      startedAt: params.startedAt,
      endedAt: params.endedAt,
      source: 'timer',
      reason: null,
      // Work on a client task is billable unless somebody says otherwise
      // (FR-23). The default matters: the opposite one loses revenue quietly.
      billable: params.billable ?? true,
      note: params.note?.trim() || null,
      /*
       * A span longer than one sitting is questionable whatever else is true,
       * so that verdict is reached here rather than being one more thing a
       * caller has to remember.
       */
      reviewReason:
        params.reviewReason ??
        (length.value.seconds > IMPLAUSIBLE_HOURS * 3600 ? 'implausible' : null),
      reviewedAt: null,
      reviewedBy: null,
      approvedAt: null,
      approvedBy: null,
      statementLineId: null,
    });

    entry.record(
      domainEvent('time.entry.recorded', params.id, params.endedAt, {
        entryId: params.id,
        assignmentId: params.assignmentId,
        seconds: length.value.seconds,
        source: 'timer',
      }),
    );
    return ok(entry);
  }

  /**
   * Time entered by hand (FR-22).
   *
   * A reason is required and the entry is flagged as manual for ever. Not
   * because people are dishonest, but because a month of manual entries is a
   * sign the timer is not being used, and that is worth being able to see.
   */
  static manual(params: {
    id: TimeEntryId;
    assignmentId: string;
    startedAt: Date;
    endedAt: Date;
    reason: string;
    billable?: boolean;
    note?: string | null;
  }): Result<TimeEntry, Conflict> {
    const reason = params.reason.trim();
    if (reason.length < 3) {
      return err(new Conflict('A manual entry needs a reason'));
    }

    const length = Duration.tryBetween(params.startedAt, params.endedAt);
    if (!length.ok) return err(new Conflict(length.error.message));
    if (length.value.seconds === 0) {
      return err(new Conflict('An entry of no length records nothing'));
    }

    const entry = new TimeEntry({
      id: params.id,
      assignmentId: params.assignmentId,
      startedAt: params.startedAt,
      endedAt: params.endedAt,
      source: 'manual',
      reason,
      billable: params.billable ?? true,
      note: params.note?.trim() || null,
      reviewReason: null,
      reviewedAt: null,
      reviewedBy: null,
      approvedAt: null,
      approvedBy: null,
      statementLineId: null,
    });

    entry.record(
      domainEvent('time.entry.recorded', params.id, params.endedAt, {
        entryId: params.id,
        assignmentId: params.assignmentId,
        seconds: length.value.seconds,
        source: 'manual',
        reason,
      }),
    );
    return ok(entry);
  }

  get assignmentId(): string {
    return this.state.assignmentId;
  }

  get source(): TimeSource {
    return this.state.source;
  }

  get billable(): boolean {
    return this.state.billable;
  }

  get isLocked(): boolean {
    return this.state.statementLineId !== null;
  }

  get isApproved(): boolean {
    return this.state.approvedAt !== null;
  }

  get length(): Duration {
    if (!this.state.endedAt) return Duration.zero();
    return Duration.between(this.state.startedAt, this.state.endedAt);
  }

  /** Long enough to be worth a second look before it is billed (FR-25). */
  get isImplausiblyLong(): boolean {
    return this.length.seconds > IMPLAUSIBLE_HOURS * 3600;
  }

  get reviewReason(): ReviewReason | null {
    return this.state.reviewReason;
  }

  /** Flagged, and nobody has said yes or no yet. */
  get awaitsReview(): boolean {
    return this.state.reviewReason !== null && this.state.reviewedAt === null;
  }

  /**
   * The person who was there says the time is right.
   *
   * The flag is kept rather than cleared. An entry that was questioned and
   * confirmed is a different thing from one nobody ever doubted, and a reader
   * of the ledger a year later should be able to tell them apart.
   */
  confirm(by: string, now: Date): Result<true, Conflict> {
    if (!this.state.reviewReason) return err(new Conflict('Nothing was in doubt about this'));
    if (this.state.reviewedAt) return err(new Conflict('That has already been confirmed'));

    const guard = this.mayChange();
    if (!guard.ok) return guard;

    this.state = { ...this.state, reviewedAt: now, reviewedBy: by };
    this.record(
      domainEvent('time.entry.confirmed', this.id, now, {
        entryId: this.id,
        reason: this.state.reviewReason,
        seconds: this.length.seconds,
      }),
    );
    return ok(true);
  }

  setBillable(billable: boolean, now: Date): Result<true, Conflict> {
    const guard = this.mayChange();
    if (!guard.ok) return guard;

    this.state = { ...this.state, billable };
    this.record(
      domainEvent('time.entry.billable_changed', this.id, now, {
        entryId: this.id,
        billable,
      }),
    );
    return ok(true);
  }

  adjust(params: { startedAt: Date; endedAt: Date; reason: string; now: Date }): Result<
    true,
    Conflict
  > {
    const guard = this.mayChange();
    if (!guard.ok) return guard;

    const reason = params.reason.trim();
    if (reason.length < 3) return err(new Conflict('Say why the time was changed'));

    const length = Duration.tryBetween(params.startedAt, params.endedAt);
    if (!length.ok) return err(new Conflict(length.error.message));

    const before = { startedAt: this.state.startedAt, endedAt: this.state.endedAt };
    this.state = {
      ...this.state,
      startedAt: params.startedAt,
      endedAt: params.endedAt,
      // Adjusted time is manual time, whatever it started as. Otherwise an
      // edited timer entry would look like an untouched one.
      source: 'manual',
      reason,
    };

    this.record(
      domainEvent('time.entry.adjusted', this.id, params.now, {
        entryId: this.id,
        reason,
        before: {
          startedAt: before.startedAt.toISOString(),
          endedAt: before.endedAt?.toISOString() ?? null,
        },
        after: {
          startedAt: params.startedAt.toISOString(),
          endedAt: params.endedAt.toISOString(),
        },
      }),
    );
    return ok(true);
  }

  approve(by: string, now: Date): Result<true, Conflict> {
    if (this.isLocked) return err(new Conflict('This time is already on a statement'));
    if (this.state.endedAt === null) return err(new Conflict('This time has not finished yet'));

    this.state = { ...this.state, approvedAt: now, approvedBy: by };
    this.record(
      domainEvent('time.entry.approved', this.id, now, { entryId: this.id, approvedBy: by }),
    );
    return ok(true);
  }

  /**
   * Include this time in a statement, which freezes it (FR-26).
   *
   * What makes a client statement defensible is that the hours behind it
   * cannot quietly change after it was sent.
   */
  includeInStatement(statementLineId: string, now: Date): Result<true, Conflict> {
    if (this.isLocked) return err(new Conflict('This time is already on a statement'));
    if (!this.isApproved) return err(new Conflict('Only approved time can be billed'));

    this.state = { ...this.state, statementLineId };
    this.record(
      domainEvent('time.entry.locked', this.id, now, {
        entryId: this.id,
        statementLineId,
      }),
    );
    return ok(true);
  }

  /** Releasing is a manager action, and recorded as one. */
  releaseFromStatement(by: string, now: Date): Result<true, Conflict> {
    if (!this.isLocked) return err(new Conflict('This time is not on a statement'));

    const was = this.state.statementLineId;
    this.state = { ...this.state, statementLineId: null };
    this.record(
      domainEvent('time.entry.released', this.id, now, {
        entryId: this.id,
        statementLineId: was,
        releasedBy: by,
      }),
    );
    return ok(true);
  }

  private mayChange(): Result<true, Conflict> {
    if (this.isLocked) {
      return err(
        new Conflict('This time is on a statement and cannot be changed', {
          statementLineId: this.state.statementLineId,
        }),
      );
    }
    return ok(true);
  }

  snapshot(): TimeEntryState {
    return this.state;
  }
}
