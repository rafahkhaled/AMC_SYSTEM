import { AggregateRoot, Conflict, type Result, domainEvent, err, ok } from '@amc/kernel';

export type LeadId = string;

/**
 * Where an enquiry came from. Kept as free text as well as a category,
 * because the category is what gets counted and the text is what tells you
 * which advertisement actually worked (FR-01).
 */
export type LeadSource = 'whatsapp' | 'phone' | 'referral' | 'advertisement' | 'walk_in' | 'other';

export type LeadStatus = 'new' | 'contacted' | 'quoted' | 'confirmed' | 'declined';

/**
 * What may follow what.
 *
 * Written out rather than left to whoever calls next, because a lead that can
 * jump from new to confirmed without anyone speaking to it produces a client
 * nobody has quoted. Going back from quoted to contacted is allowed: people
 * do reopen conversations.
 */
const ALLOWED: Readonly<Record<LeadStatus, readonly LeadStatus[]>> = {
  new: ['contacted', 'declined'],
  contacted: ['quoted', 'declined', 'contacted'],
  quoted: ['confirmed', 'declined', 'contacted'],
  // Both are ends. A new enquiry from the same person is a new lead, so the
  // history of the first one stays true.
  confirmed: [],
  declined: [],
};

export interface LeadState {
  readonly id: LeadId;
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly source: LeadSource;
  readonly sourceDetail: string | null;
  readonly requestedService: string | null;
  readonly status: LeadStatus;
  readonly convertedClientId: string | null;
  readonly receivedAt: Date;
  readonly notes: string | null;
}

export class Lead extends AggregateRoot<LeadId> {
  private constructor(private state: LeadState) {
    super(state.id);
  }

  static rehydrate(state: LeadState): Lead {
    return new Lead(state);
  }

  static capture(params: {
    id: LeadId;
    name: string;
    phone?: string | null;
    email?: string | null;
    source: LeadSource;
    sourceDetail?: string | null;
    requestedService?: string | null;
    now: Date;
  }): Result<Lead, Conflict> {
    const name = params.name.trim();
    if (name.length === 0) return err(new Conflict('An enquiry needs a name'));

    // Someone has to be reachable, or the enquiry cannot be followed up and is
    // not really a lead at all.
    const phone = params.phone?.trim() || null;
    const email = params.email?.trim() || null;
    if (!phone && !email) {
      return err(new Conflict('An enquiry needs a phone number or an email address'));
    }

    const lead = new Lead({
      id: params.id,
      name,
      phone,
      email,
      source: params.source,
      sourceDetail: params.sourceDetail?.trim() || null,
      requestedService: params.requestedService?.trim() || null,
      status: 'new',
      convertedClientId: null,
      receivedAt: params.now,
      notes: null,
    });

    lead.record(
      domainEvent('clients.lead.captured', params.id, params.now, {
        leadId: params.id,
        source: params.source,
        requestedService: params.requestedService ?? null,
      }),
    );
    return ok(lead);
  }

  get status(): LeadStatus {
    return this.state.status;
  }

  get name(): string {
    return this.state.name;
  }

  get convertedClientId(): string | null {
    return this.state.convertedClientId;
  }

  moveTo(status: LeadStatus, now: Date, note?: string): Result<true, Conflict> {
    if (!ALLOWED[this.state.status].includes(status)) {
      return err(
        new Conflict(`An enquiry cannot go from ${this.state.status} to ${status}`, {
          from: this.state.status,
          to: status,
        }),
      );
    }
    const from = this.state.status;
    this.state = { ...this.state, status, notes: note?.trim() || this.state.notes };
    this.record(
      domainEvent('clients.lead.status_changed', this.id, now, {
        leadId: this.id,
        from,
        to: status,
      }),
    );
    return ok(true);
  }

  /**
   * Becomes a client.
   *
   * The lead is kept rather than replaced, and the link runs both ways. Six
   * months later the question "where did this client come from?" has an
   * answer, which is the only reason to record a source in the first place.
   */
  convertTo(clientId: string, now: Date): Result<true, Conflict> {
    if (this.state.convertedClientId) {
      return err(new Conflict('This enquiry has already become a client'));
    }
    if (this.state.status === 'declined') {
      return err(new Conflict('A declined enquiry cannot become a client'));
    }

    this.state = { ...this.state, status: 'confirmed', convertedClientId: clientId };
    this.record(
      domainEvent('clients.lead.converted', this.id, now, {
        leadId: this.id,
        clientId,
        source: this.state.source,
      }),
    );
    return ok(true);
  }

  snapshot(): LeadState {
    return this.state;
  }
}
