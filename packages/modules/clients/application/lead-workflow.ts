import {
  Conflict,
  Conflict as ConflictError,
  type EventCollector,
  type IdGenerator,
  type Result,
  type UnitOfWork,
  actorFrom,
  err,
  ok,
} from '@amc/kernel';
import { Client, Lead, type LeadSource, type LeadStatus } from '../domain/index.js';
import type { CallerLike, ClientRepository, LeadRepository } from './ports.js';

export interface LeadRepositoryFactory {
  forTransaction(
    db: unknown,
    collector: EventCollector,
  ): { leads: LeadRepository; clients: ClientRepository };
}

/** Everything that changes an enquiry. */
export class LeadWorkflow {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repositories: LeadRepositoryFactory,
    private readonly ids: IdGenerator,
  ) {}

  capture(
    caller: CallerLike,
    params: {
      name: string;
      phone?: string | undefined;
      email?: string | undefined;
      source: string;
      sourceDetail?: string | undefined;
      requestedService?: string | undefined;
    },
  ): Promise<Result<{ leadId: string }, Conflict>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const { leads } = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );

      const id = this.ids.next();
      const lead = Lead.capture({
        id,
        name: params.name,
        ...(params.phone === undefined ? {} : { phone: params.phone }),
        ...(params.email === undefined ? {} : { email: params.email }),
        source: params.source as LeadSource,
        ...(params.sourceDetail === undefined ? {} : { sourceDetail: params.sourceDetail }),
        ...(params.requestedService === undefined
          ? {}
          : { requestedService: params.requestedService }),
        now: new Date(),
      });
      if (!lead.ok) return err(lead.error);

      await leads.save(lead.value);
      return ok({ leadId: id });
    });
  }

  move(
    caller: CallerLike,
    id: string,
    to: LeadStatus,
    note?: string,
  ): Promise<Result<true, Conflict>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const { leads } = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );

      const lead = await leads.findById(id);
      if (!lead) return err(new ConflictError('No such enquiry'));

      const moved = note ? lead.moveTo(to, new Date(), note) : lead.moveTo(to, new Date());
      if (!moved.ok) return err(moved.error);

      await leads.save(lead);
      return ok(true as const);
    });
  }

  /**
   * The enquiry becomes a client, in one transaction.
   *
   * Both writes commit together or neither does. Half of this would be a
   * client nobody can trace the origin of, or an enquiry marked converted
   * pointing at a company that was never created — and the second is worse,
   * because it looks finished.
   */
  /**
   * Quoting an enquiry (FR-01, FR-30).
   *
   * Creates the client the quotation will belong to and moves the lead to
   * `quoted` in one transaction — a client with no lead pointing at it, or a
   * lead marked quoted with no client to quote, are both worse than failing.
   *
   * It does not draft the quotation. That belongs to billing, and reaching
   * across to it from here would put one module's writes inside another's
   * transaction. The caller takes the client id and drafts against it.
   */
  quote(
    caller: CallerLike,
    id: string,
    legalName: string,
  ): Promise<Result<{ clientId: string }, Conflict>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const { leads, clients } = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );

      const lead = await leads.findById(id);
      if (!lead) return err(new ConflictError('No such enquiry'));

      const clientId = this.ids.next();
      const now = new Date();
      const client = Client.onboard({ id: clientId, legalName: legalName.trim(), now });
      if (!client.ok) return err(client.error);

      const quoted = lead.quotedAs(clientId, now);
      if (!quoted.ok) return err(quoted.error);

      await clients.save(client.value);
      await leads.save(lead);
      return ok({ clientId });
    });
  }

  convert(
    caller: CallerLike,
    id: string,
    legalName: string,
  ): Promise<Result<{ clientId: string }, Conflict>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const { leads, clients } = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );

      const lead = await leads.findById(id);
      if (!lead) return err(new ConflictError('No such enquiry'));

      const now = new Date();
      /*
       * A quoted enquiry already has its client, made when the quotation was
       * drafted. Onboarding a second one would leave the quotation against a
       * company the confirmed client is not.
       */
      const existing = lead.convertedClientId;
      const clientId = existing ?? this.ids.next();

      if (!existing) {
        const client = Client.onboard({ id: clientId, legalName: legalName.trim(), now });
        if (!client.ok) return err(client.error);
        await clients.save(client.value);
      }

      const converted = lead.convertTo(clientId, now);
      if (!converted.ok) return err(converted.error);

      await leads.save(lead);
      return ok({ clientId });
    });
  }
}
