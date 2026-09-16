import type { Holiday } from '../domain/index.js';

/** Who may see which clients, passed down from the caller. */
export type CalendarScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'assigned'; readonly userId: string }
  | { readonly kind: 'none' };

export interface CallerLike {
  readonly userId: string;
  readonly permissions: ReadonlySet<string> | readonly string[];
}

/** A dated obligation, before the business calendar has been applied to it. */
export interface DueThing {
  readonly id: string;
  readonly kind: 'vat_return' | 'ct_return' | 'document_expiry' | 'task' | 'custom';
  readonly clientId: string;
  readonly clientName: string;
  readonly subject: string;
  readonly periodKey: string | null;
  /** The date as recorded: a statutory date, or an expiry printed on a licence. */
  readonly dueOn: Date;
  readonly isDone: boolean;
  readonly taskId: string | null;
}

/**
 * Everything with a date on it, from the modules that own those dates.
 *
 * Supplied by the composition root. Tasks belong to services and documents to
 * clients; this module owns neither, and knows only how to place a date on a
 * calendar and move it off a day nobody is open.
 */
export interface DeadlineSource {
  between(scope: CalendarScope, from: Date, to: Date): Promise<DueThing[]>;
  /** What is already late, whenever it was due. */
  overdue(scope: CalendarScope, asOf: Date): Promise<DueThing[]>;
}

export interface HolidaySource {
  between(from: Date, to: Date): Promise<Holiday[]>;
}
