import { describe, expect, it } from 'vitest';
import { Lead } from '../domain/index.js';
import { ReadLeads } from './read-leads.js';

const at = (iso: string) => new Date(iso);
const NOW = at('2026-03-20T06:00:00Z');

function lead(id: string, over: Partial<Parameters<typeof Lead.capture>[0]> = {}) {
  const created = Lead.capture({
    id,
    name: `Enquiry ${id}`,
    phone: '+971 50 000 0000',
    source: 'whatsapp',
    now: at('2026-03-18T06:00:00Z'),
    ...over,
  });
  if (!created.ok) throw new Error('fixture');
  return created.value;
}

const board = (leads: Lead[]) =>
  new ReadLeads(
    { all: async () => leads, findById: async () => null, save: async () => undefined },
    {
      now: () => NOW,
    },
  ).board();

describe('the enquiry pipeline', () => {
  it('leaves confirmed enquiries off the board and keeps declined ones on it', async () => {
    /*
     * Backwards until you ask what the board is for. A confirmed enquiry has
     * become a client and lives on the clients list; a declined one is the
     * column that tells a partner what is being lost.
     */
    const view = await board([]);
    expect(view.columns.map((column) => column.status)).toEqual([
      'new',
      'contacted',
      'quoted',
      'declined',
    ]);
  });

  it('puts the longest wait at the top of its column', async () => {
    // An enquiry nobody has answered for a week is the one to look at, not
    // the one that arrived this morning.
    const view = await board([
      lead('fresh', { now: NOW }),
      lead('stale', { now: at('2026-03-10T06:00:00Z') }),
    ]);

    const names = view.columns[0]?.leads.map((entry) => entry.id);
    expect(names).toEqual(['stale', 'fresh']);
  });

  it('counts the wait in whole days, from when it arrived', async () => {
    const view = await board([lead('a', { now: at('2026-03-13T06:00:00Z') })]);
    expect(view.columns[0]?.leads[0]?.waitingDays).toBe(7);
  });

  it('never reports a negative wait for something logged moments ago', async () => {
    const view = await board([lead('a', { now: at('2026-03-20T07:00:00Z') })]);
    expect(view.columns[0]?.leads[0]?.waitingDays).toBe(0);
  });

  it('carries what each enquiry may become, so the screen need not decide', async () => {
    const view = await board([lead('a')]);
    expect(view.columns[0]?.leads[0]?.allowedNext).toEqual(['contacted', 'declined']);
  });
});
