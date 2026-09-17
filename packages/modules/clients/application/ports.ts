import type {
  Client,
  ClientCredential,
  ClientDocument,
  ClientId,
  ClientScope,
  ContactLogEntry,
  DocumentId,
  DocumentTypeCode,
  Lead,
  LeadId,
  Trn,
} from '../domain/index.js';

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
  all(options?: { limit?: number }): Promise<Lead[]>;
  findById(id: LeadId): Promise<Lead | null>;
  save(lead: Lead): Promise<void>;
}

/** A document that is about to lapse, and the client it belongs to. */
export interface ExpiringDocument {
  readonly documentId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly type: DocumentTypeCode;
  readonly expiresOn: Date;
  readonly daysRemaining: number;
}

/**
 * The caller: enough to decide what they may see, and enough to name them in
 * the audit log. The display name is not optional for that second reason.
 */
export interface CallerLike {
  readonly userId: string;
  readonly permissions: ReadonlySet<string> | readonly string[];
  readonly roles: readonly string[];
  readonly displayName: string;
  readonly sessionId?: string | undefined;
}

export interface ContactLogRepository {
  forClient(clientId: string, scope: ClientScope): Promise<ContactLogEntry[]>;
  save(entry: ContactLogEntry): Promise<void>;
}

export interface CredentialRepository {
  currentFor(clientId: string, scope: ClientScope): Promise<ClientCredential[]>;
  findById(id: string, scope: ClientScope): Promise<ClientCredential | null>;
  save(credential: ClientCredential): Promise<void>;
}

export interface DocumentRepository {
  findById(id: DocumentId, scope: ClientScope): Promise<ClientDocument | null>;
  /** The live documents for a client: superseded versions are not included. */
  currentFor(clientId: ClientId, scope: ClientScope): Promise<ClientDocument[]>;
  /**
   * What the deadline engine asks every morning.
   *
   * Unscoped, because the engine runs as the system rather than as a person.
   * The alerts it raises are then delivered to whoever is assigned.
   */
  expiringOn(days: number, today: Date): Promise<ExpiringDocument[]>;
  save(document: ClientDocument): Promise<void>;
}
