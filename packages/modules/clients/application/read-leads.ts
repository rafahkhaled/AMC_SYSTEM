import type { LeadBoard, LeadView } from '@amc/contracts';
import { type Clock } from '@amc/kernel';
import type { Lead, LeadStatus } from '../domain/index.js';
import type { LeadRepository } from './ports.js';

/**
 * The pipeline, in the order an enquiry moves through it.
 *
 * Declined is on the board and confirmed is not. That looks backwards until
 * you ask what the board is for: confirmed enquiries have become clients and
 * live on the clients screen, while a declined one is worth seeing for a
 * while — it is the column that tells a partner what is being lost.
 */
const COLUMNS: readonly LeadStatus[] = ['new', 'contacted', 'quoted', 'declined'];

export class ReadLeads {
  constructor(
    private readonly leads: LeadRepository,
    private readonly clock: Clock,
  ) {}

  async board(): Promise<LeadBoard> {
    const all = await this.leads.all();
    const now = this.clock.now();
    const views = all.map((lead) => toView(lead, now));

    return {
      columns: COLUMNS.map((status) => ({
        status,
        leads: views
          .filter((lead) => lead.status === status)
          // Longest wait first. An enquiry nobody has answered for a week is
          // the one that needs looking at, not the one that arrived today.
          .sort((a, b) => b.waitingDays - a.waitingDays),
      })),
    };
  }
}

function toView(lead: Lead, now: Date): LeadView {
  const state = lead.snapshot();
  const days = Math.floor((now.getTime() - state.receivedAt.getTime()) / 86_400_000);

  return {
    id: state.id,
    name: state.name,
    phone: state.phone,
    email: state.email,
    source: state.source,
    sourceDetail: state.sourceDetail,
    requestedService: state.requestedService,
    status: state.status,
    convertedClientId: state.convertedClientId,
    receivedAt: state.receivedAt.toISOString(),
    notes: state.notes,
    allowedNext: [...lead.allowedNext()],
    waitingDays: Math.max(0, days),
  };
}
