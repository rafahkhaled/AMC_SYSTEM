import type { Quotation } from '../domain/index.js';

export interface QuotationRepository {
  findById(id: string): Promise<Quotation | null>;
  /** The reference is what a client says on the phone. */
  findByReference(reference: string): Promise<Quotation | null>;
  save(quotation: Quotation): Promise<void>;
  /** Sent, past their date, and still waiting — what the expiry sweep asks. */
  lapsed(asOf: Date, limit: number): Promise<Quotation[]>;
}

/** The caller. Re-exported so modules import their ports, not the kernel. */
export type { CallerLike } from '@amc/kernel';
