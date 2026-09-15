import type { Client, ClientId, ClientScope, Lead, LeadId, Trn } from '../domain/index.js';

export interface ClientSummary {
  readonly id: string;
  readonly legalName: string;
  readonly status: string;
  readonly vatState: string;
  readonly vatTrn: string | null;
}

/**
 * Every read takes a scope, and it is not optional.
 *
 * That is the whole design. A query that forgets to restrict itself cannot be
 * written, because there is nothing sensible to pass. Remembering to add a
 * filter works until the one time somebody does not, and then fails silently
 * for as long as nobody looks.
 */
export interface ClientRepository {
  findById(id: ClientId, scope: ClientScope): Promise<Client | null>;
  list(scope: ClientScope, options?: { limit?: number }): Promise<ClientSummary[]>;
  /**
   * Deliberately unscoped: onboarding has to know whether a number is already
   * in use even when the caller cannot see the client using it. It returns
   * only whether one exists, never which.
   */
  isVatTrnTaken(trn: Trn): Promise<boolean>;
  save(client: Client): Promise<void>;
}

export interface StaffAccessRepository {
  assign(params: { clientId: string; userId: string; assignedBy: string }): Promise<void>;
  revoke(clientId: string, userId: string): Promise<void>;
  clientsFor(userId: string): Promise<string[]>;
  staffFor(clientId: string): Promise<string[]>;
}

export interface LeadRepository {
  findById(id: LeadId): Promise<Lead | null>;
  save(lead: Lead): Promise<void>;
}
