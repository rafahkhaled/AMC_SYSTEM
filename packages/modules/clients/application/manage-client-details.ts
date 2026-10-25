import type { ChangeClientDetails } from '@amc/contracts';
import {
  Conflict,
  type IdGenerator,
  NotFound,
  type Result,
  type UnitOfWork,
  actorFrom,
  err,
  ok,
} from '@amc/kernel';
import { Client, FinancialYear, Trn, VatPeriods, scopeFor } from '../domain/index.js';
import type { CallerLike, ClientRepositoryFactory, StaffAccessRepository } from './ports.js';

const today = (): Date => {
  const now = new Date();
  return new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
};
const dayOf = (given: string | undefined): Date =>
  given ? new Date(`${given}T00:00:00Z`) : today();

/**
 * Correcting and completing what the firm knows about a client.
 *
 * Clients arrive from a converted enquiry with a name and nothing else, so this
 * is where the licence number, the tax numbers, the person to call and the
 * weekly day off are filled in. One call, one transaction, one audit entry per
 * thing that changed: a half-saved form would leave a client with a TRN and no
 * cycle to file it on.
 */
export class ManageClientDetails {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repositories: ClientRepositoryFactory,
    /** Who may see which client, so a person who adds one can then open it. */
    private readonly access?: { forTransaction(db: unknown): StaffAccessRepository },
    private readonly ids?: IdGenerator,
  ) {}

  /**
   * Adding a client directly (feedback, "App" document point 1).
   *
   * Clients used to arrive only by converting an enquiry, so somebody with a
   * client already on the books had to invent an enquiry to add them. The
   * person adding it is given access, so somebody who sees only their own
   * clients does not add one and then lose sight of it.
   */
  async onboard(
    caller: CallerLike,
    command: {
      legalName: string;
      legalNameArabic?: string | undefined;
      tradeLicenceNumber?: string | undefined;
    },
  ): Promise<Result<{ clientId: string }, Conflict>> {
    const id = this.ids?.next();
    if (!id) return err(new Conflict('Adding clients is not available here'));
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const db = (context as unknown as { db: unknown }).db;
      const clients = this.repositories.forTransaction(db, context);
      const client = Client.onboard({
        id,
        legalName: command.legalName,
        ...(command.legalNameArabic ? { legalNameArabic: command.legalNameArabic } : {}),
        ...(command.tradeLicenceNumber ? { tradeLicenceNumber: command.tradeLicenceNumber } : {}),
        now: new Date(),
      });
      if (!client.ok) return err(client.error);
      await clients.save(client.value);

      if (scopeFor(caller).kind !== 'all' && this.access) {
        await this.access.forTransaction(db).assign({
          clientId: id,
          userId: caller.userId,
          assignedBy: caller.userId,
        });
      }
      return ok({ clientId: id });
    });
  }

  async change(
    caller: CallerLike,
    clientId: string,
    command: ChangeClientDetails,
  ): Promise<Result<true, Conflict | NotFound>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const clients = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );
      const client = await clients.findById(clientId, scopeFor(caller));
      if (!client) return err(new NotFound('No such client'));
      const now = new Date();

      const details = client.changeDetails(
        {
          ...(command.tradeLicenceNumber !== undefined && {
            tradeLicenceNumber: command.tradeLicenceNumber,
          }),
          ...(command.contactPerson !== undefined && { contactPerson: command.contactPerson }),
          ...(command.contactEmail !== undefined && { contactEmail: command.contactEmail }),
          ...(command.mobile !== undefined && { mobile: command.mobile }),
          ...(command.landline !== undefined && { landline: command.landline }),
          ...(command.weeklyDayOff !== undefined && { weeklyDayOff: command.weeklyDayOff }),
          ...(command.address !== undefined && { address: command.address }),
          ...(command.opensAt !== undefined && { opensAt: command.opensAt }),
          ...(command.closesAt !== undefined && { closesAt: command.closesAt }),
        },
        now,
      );
      if (!details.ok) return err(details.error);

      if (command.vat) {
        const outcome = await this.vat(clients, client, command.vat, now);
        if (!outcome.ok) return outcome;
      }
      if (command.corporateTax) {
        const outcome = this.corporateTax(client, command.corporateTax, now);
        if (!outcome.ok) return outcome;
      }

      if (command.references) {
        const labels = new Set<string>();
        for (const reference of command.references) {
          const key = reference.label.toLowerCase();
          if (labels.has(key)) {
            return err(new Conflict(`"${reference.label}" is listed twice`));
          }
          labels.add(key);
        }
        await clients.replaceReferences(clientId, command.references);
        client.noteReferencesChanged(
          command.references.map((reference) => reference.label),
          now,
        );
      }

      await clients.save(client);
      return ok(true as const);
    });
  }

  private async vat(
    clients: ReturnType<ClientRepositoryFactory['forTransaction']>,
    client: NonNullable<
      Awaited<ReturnType<ReturnType<ClientRepositoryFactory['forTransaction']>['findById']>>
    >,
    given: NonNullable<ChangeClientDetails['vat']>,
    now: Date,
  ): Promise<Result<true, Conflict>> {
    const trn = Trn.of(given.trn);
    if (!trn.ok) return err(new Conflict(trn.error.message));
    if (await clients.isVatTrnTaken(trn.value, client.id)) {
      return err(new Conflict('Another client already has that VAT number'));
    }
    if (client.vat.state === 'registered') return client.correctTrn('vat', trn.value, now);

    if (given.frequency === undefined || given.anchorEndMonth === undefined) {
      return err(
        new Conflict(
          'To register for VAT, say how often it is filed and which month a period ends',
        ),
      );
    }
    const periods = VatPeriods.of(given.frequency, given.anchorEndMonth);
    if (!periods.ok) return err(new Conflict(periods.error.message));
    return client.registerForVat({
      trn: trn.value,
      registeredOn: dayOf(given.registeredOn),
      periods: periods.value,
      now,
    });
  }

  private corporateTax(
    client: NonNullable<
      Awaited<ReturnType<ReturnType<ClientRepositoryFactory['forTransaction']>['findById']>>
    >,
    given: NonNullable<ChangeClientDetails['corporateTax']>,
    now: Date,
  ): Result<true, Conflict> {
    const trn = Trn.of(given.trn);
    if (!trn.ok) return err(new Conflict(trn.error.message));
    if (client.corporateTax.state === 'registered') {
      return client.correctTrn('corporate_tax', trn.value, now);
    }

    if (given.financialYearEndMonth === undefined) {
      return err(
        new Conflict('To register for corporation tax, say which month the financial year ends'),
      );
    }
    const year = FinancialYear.endingIn(given.financialYearEndMonth);
    if (!year.ok) return err(new Conflict(year.error.message));
    return client.registerForCorporateTax({
      trn: trn.value,
      registeredOn: dayOf(given.registeredOn),
      financialYear: year.value,
      now,
    });
  }
}
