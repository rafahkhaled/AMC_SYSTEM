import type { Client, ClientId, Trn } from '../domain/index.js';

export interface ClientRepository {
  findById(id: ClientId): Promise<Client | null>;
  /** So a second client cannot be onboarded under a number already in use. */
  findByVatTrn(trn: Trn): Promise<Client | null>;
  save(client: Client): Promise<void>;
}
