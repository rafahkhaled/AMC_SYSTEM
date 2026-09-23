import type { StaffMember } from '@amc/contracts';
import { type CallerLike, heldBy } from '@amc/kernel';

/**
 * The staff directory, as the database can answer it.
 *
 * Supplied by the composition root: the counts join projects, assignments and
 * time entries, which belong to other modules, and identity does not reach
 * across to get them.
 */
export interface StaffReader {
  /** Every active person, with their counts already summed. */
  all(params: { thisMonthStart: Date; lastMonthStart: Date; now: Date }): Promise<StaffMember[]>;
}

/**
 * Who works here, and what they are carrying (X-01).
 *
 * A manager currently opens four screens to ask "what is this person doing
 * this week". This is that question as one row per person.
 *
 * Everybody sees the directory — names, roles, and the hours each person
 * works, which is ordinary colleague information and is what stops somebody
 * ringing a part-timer on their day off. Only somebody who manages people
 * sees how many hours each has booked.
 */
export class ReadStaff {
  constructor(private readonly reader: StaffReader) {}

  async directory(caller: CallerLike): Promise<StaffMember[]> {
    const now = new Date();
    const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

    const staff = await this.reader.all({ thisMonthStart, lastMonthStart, now });
    if (heldBy(caller).has('users.manage')) return staff;

    /*
     * Hours removed rather than zeroed.
     *
     * A zero is a statement about the person — they booked nothing this month
     * — and this is a statement about the reader. Sending zeros would have
     * the screen quietly accuse everybody of doing nothing.
     */
    return staff.map((person) => ({
      ...person,
      thisMonthSeconds: null,
      lastMonthSeconds: null,
    }));
  }
}
