import { type CurrencyCode, type EventCollector, Money, Rate } from '@amc/kernel';
import { and, asc, eq, exists, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ClientRepository, ClientSummary } from '../application/ports.js';
import {
  Client,
  type ClientId,
  type ClientScope,
  type ClientState,
  type ClientStatus,
  FinancialYear,
  NOT_REGISTERED,
  RateHistory,
  type RegistrationState,
  type TaxRegistration,
  Trn,
  type VatFrequency,
  VatPeriods,
} from '../domain/index.js';
import { clientRates, clientStaffAccess, clients } from './schema.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

/** Dates are stored as calendar dates; a client's year end is a day, not an instant. */
const asDate = (value: string | null): Date | null =>
  value ? new Date(`${value}T00:00:00Z`) : null;
const asColumn = (value: Date | null): string | null =>
  value ? (value.toISOString().slice(0, 10) as string) : null;

export class DrizzleClientRepository implements ClientRepository {
  constructor(
    private readonly db: Db,
    private readonly collector?: EventCollector,
  ) {}

  /**
   * Out of scope reads as not found rather than forbidden.
   *
   * Refusing would tell the asker the client exists, which is itself worth
   * knowing to someone checking whether a competitor is on the firm's books.
   * Not found says nothing either way.
   */
  async findById(id: ClientId, scope: ClientScope): Promise<Client | null> {
    if (scope.kind === 'none') return null;

    const [row] = await this.db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), this.visibleTo(scope)))
      .limit(1);

    if (!row) return null;
    return this.toAggregate(row, await this.ratesOf(id));
  }

  async list(scope: ClientScope, options: { limit?: number } = {}): Promise<ClientSummary[]> {
    if (scope.kind === 'none') return [];

    return this.db
      .select({
        id: clients.id,
        legalName: clients.legalName,
        status: clients.status,
        vatState: clients.vatState,
        vatTrn: clients.vatTrn,
      })
      .from(clients)
      .where(this.visibleTo(scope))
      .orderBy(asc(clients.legalName))
      .limit(options.limit ?? 100);
  }

  /**
   * Unscoped on purpose, and answers only yes or no.
   *
   * Onboarding has to know a tax number is already in use even when the person
   * doing it cannot see the client using it. Returning that client instead
   * would leak exactly what the scoping exists to protect.
   */
  async isVatTrnTaken(trn: Trn): Promise<boolean> {
    const [row] = await this.db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.vatTrn, trn.value))
      .limit(1);
    return row !== undefined;
  }

  /**
   * The scope, as a condition on the query.
   *
   * An accountant sees a client only where a row assigns it to them. This is a
   * correlated join rather than a list of ids fetched beforehand, so an
   * assignment changed mid-request cannot be answered from a stale list.
   */
  private visibleTo(scope: ClientScope) {
    if (scope.kind === 'all') return undefined;
    if (scope.kind === 'none') return sql`false`;
    return exists(
      this.db
        .select({ one: clientStaffAccess.clientId })
        .from(clientStaffAccess)
        .where(
          and(
            eq(clientStaffAccess.clientId, clients.id),
            eq(clientStaffAccess.userId, scope.userId),
          ),
        ),
    );
  }

  async save(client: Client): Promise<void> {
    this.collector?.collect(client.pullEvents());
    const state = client.snapshot();

    const row = {
      id: state.id,
      legalName: state.legalName,
      legalNameArabic: state.legalNameArabic,
      tradeLicenceNumber: state.tradeLicenceNumber,
      status: state.status,
      vatState: state.vat.state,
      vatTrn: state.vat.trn?.value ?? null,
      vatRegisteredOn: asColumn(state.vat.registeredOn),
      vatDeregisteredOn: asColumn(state.vat.deregisteredOn),
      vatFrequency: state.vatPeriods?.frequency ?? null,
      vatAnchorEndMonth: state.vatPeriods?.anchorEndMonth ?? null,
      ctState: state.corporateTax.state,
      ctTrn: state.corporateTax.trn?.value ?? null,
      ctRegisteredOn: asColumn(state.corporateTax.registeredOn),
      ctDeregisteredOn: asColumn(state.corporateTax.deregisteredOn),
      financialYearEndMonth: state.financialYear?.endMonth ?? null,
      onboardedOn: state.onboardedOn,
      notes: state.notes,
    };

    await this.db.insert(clients).values(row).onConflictDoUpdate({ target: clients.id, set: row });

    // Rates are append-only in practice: a change is a new row, never an edit
    // of an old one, or history would stop being history.
    const existing = new Set(
      (await this.ratesOf(state.id)).map((change) => change.effectiveFrom.toISOString()),
    );
    const added = state.rates.all.filter(
      (change) => !existing.has(change.effectiveFrom.toISOString()),
    );

    if (added.length > 0) {
      await this.db.insert(clientRates).values(
        added.map((change, index) => ({
          id: `${state.id}-rate-${change.effectiveFrom.toISOString().slice(0, 10)}-${index}`,
          clientId: state.id,
          perHourMinor: change.rate.perHour.minorUnits,
          currency: change.rate.currency,
          effectiveFrom: change.effectiveFrom.toISOString().slice(0, 10),
          changedBy: change.changedBy,
          note: change.note ?? null,
        })),
      );
    }
  }

  private async ratesOf(id: ClientId) {
    const rows = await this.db
      .select()
      .from(clientRates)
      .where(eq(clientRates.clientId, id))
      .orderBy(asc(clientRates.effectiveFrom));

    return rows.map((row) => ({
      rate: Rate.perHour(Money.ofMinor(row.perHourMinor, row.currency as CurrencyCode)),
      effectiveFrom: new Date(`${row.effectiveFrom}T00:00:00Z`),
      changedBy: row.changedBy,
      note: row.note ?? undefined,
    }));
  }

  private toAggregate(
    row: typeof clients.$inferSelect,
    rates: Awaited<ReturnType<DrizzleClientRepository['ratesOf']>>,
  ): Client {
    const state: ClientState = {
      id: row.id,
      legalName: row.legalName,
      legalNameArabic: row.legalNameArabic,
      tradeLicenceNumber: row.tradeLicenceNumber,
      status: row.status as ClientStatus,
      vat: registrationOf(row.vatState, row.vatTrn, row.vatRegisteredOn, row.vatDeregisteredOn),
      corporateTax: registrationOf(
        row.ctState,
        row.ctTrn,
        row.ctRegisteredOn,
        row.ctDeregisteredOn,
      ),
      vatPeriods: periodsOf(row.vatFrequency, row.vatAnchorEndMonth),
      financialYear: yearOf(row.financialYearEndMonth),
      rates: RateHistory.from(rates),
      onboardedOn: row.onboardedOn,
      notes: row.notes,
    };
    return Client.rehydrate(state);
  }
}

function registrationOf(
  state: string,
  trn: string | null,
  registeredOn: string | null,
  deregisteredOn: string | null,
): TaxRegistration {
  if (state === 'not_registered') return NOT_REGISTERED;

  const parsed = trn ? Trn.of(trn) : null;
  if (trn && (!parsed || !parsed.ok)) {
    // The column is constrained to fifteen digits, so this means the row was
    // written by something other than this code.
    throw new Error(`Stored tax registration number is not usable: ${trn}`);
  }

  return {
    state: state as RegistrationState,
    trn: parsed?.ok ? parsed.value : null,
    registeredOn: asDate(registeredOn),
    deregisteredOn: asDate(deregisteredOn),
  };
}

function periodsOf(frequency: string | null, anchor: number | null): VatPeriods | null {
  if (!frequency || anchor === null) return null;
  const parsed = VatPeriods.of(frequency as VatFrequency, anchor);
  return parsed.ok ? parsed.value : null;
}

function yearOf(endMonth: number | null): FinancialYear | null {
  if (endMonth === null) return null;
  const parsed = FinancialYear.endingIn(endMonth);
  return parsed.ok ? parsed.value : null;
}
