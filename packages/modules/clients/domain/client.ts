import { AggregateRoot, Conflict, type Rate, type Result, domainEvent, err, ok } from '@amc/kernel';
import { type RateChange, RateHistory } from './client-rate.js';
import type { FinancialYear, VatPeriods } from './tax-period.js';
import type { Trn } from './trn.js';

export type ClientId = string;
export type ClientStatus = 'active' | 'dormant' | 'closed';

/**
 * Whether a client is registered for a tax, and under which number.
 *
 * Registration is not a boolean. A client can be not registered, registered,
 * or deregistered, and the last is not the same as the first: a deregistered
 * client still has filings for the periods it was registered, and its number
 * still appears on documents already issued.
 */
export type RegistrationState = 'not_registered' | 'registered' | 'deregistered';

export interface TaxRegistration {
  readonly state: RegistrationState;
  readonly trn: Trn | null;
  readonly registeredOn: Date | null;
  readonly deregisteredOn: Date | null;
}

export const NOT_REGISTERED: TaxRegistration = {
  state: 'not_registered',
  trn: null,
  registeredOn: null,
  deregisteredOn: null,
};

export interface ClientState {
  readonly id: ClientId;
  readonly legalName: string;
  readonly legalNameArabic: string | null;
  readonly tradeLicenceNumber: string | null;
  readonly status: ClientStatus;
  readonly vat: TaxRegistration;
  readonly corporateTax: TaxRegistration;
  readonly vatPeriods: VatPeriods | null;
  readonly financialYear: FinancialYear | null;
  readonly rates: RateHistory;
  readonly onboardedOn: Date;
  readonly notes: string | null;
}

export class Client extends AggregateRoot<ClientId> {
  private constructor(private state: ClientState) {
    super(state.id);
  }

  static rehydrate(state: ClientState): Client {
    return new Client(state);
  }

  static onboard(params: {
    id: ClientId;
    legalName: string;
    legalNameArabic?: string | null;
    tradeLicenceNumber?: string | null;
    now: Date;
  }): Result<Client, Conflict> {
    const legalName = params.legalName.trim();
    if (legalName.length === 0) {
      return err(new Conflict('A client needs a legal name'));
    }

    const client = new Client({
      id: params.id,
      legalName,
      legalNameArabic: params.legalNameArabic?.trim() || null,
      tradeLicenceNumber: params.tradeLicenceNumber?.trim() || null,
      status: 'active',
      vat: NOT_REGISTERED,
      corporateTax: NOT_REGISTERED,
      vatPeriods: null,
      financialYear: null,
      rates: RateHistory.empty(),
      onboardedOn: params.now,
      notes: null,
    });

    client.record(
      domainEvent('clients.client.onboarded', params.id, params.now, {
        clientId: params.id,
        legalName,
      }),
    );
    return ok(client);
  }

  get legalName(): string {
    return this.state.legalName;
  }

  get status(): ClientStatus {
    return this.state.status;
  }

  get vat(): TaxRegistration {
    return this.state.vat;
  }

  get corporateTax(): TaxRegistration {
    return this.state.corporateTax;
  }

  get vatPeriods(): VatPeriods | null {
    return this.state.vatPeriods;
  }

  get financialYear(): FinancialYear | null {
    return this.state.financialYear;
  }

  get rates(): RateHistory {
    return this.state.rates;
  }

  /**
   * Register for VAT. The period cycle is required, because a registration
   * without one cannot produce a filing date, and a client registered for VAT
   * with no deadline is exactly the client who gets missed.
   */
  registerForVat(params: {
    trn: Trn;
    registeredOn: Date;
    periods: VatPeriods;
    now: Date;
  }): Result<true, Conflict> {
    if (this.state.vat.state === 'registered') {
      return err(new Conflict('This client is already registered for VAT'));
    }
    this.state = {
      ...this.state,
      vat: {
        state: 'registered',
        trn: params.trn,
        registeredOn: params.registeredOn,
        deregisteredOn: null,
      },
      vatPeriods: params.periods,
    };
    this.record(
      domainEvent('clients.client.vat_registered', this.id, params.now, {
        clientId: this.id,
        trn: params.trn.value,
        frequency: params.periods.frequency,
      }),
    );
    return ok(true);
  }

  registerForCorporateTax(params: {
    trn: Trn;
    registeredOn: Date;
    financialYear: FinancialYear;
    now: Date;
  }): Result<true, Conflict> {
    if (this.state.corporateTax.state === 'registered') {
      return err(new Conflict('This client is already registered for corporation tax'));
    }
    this.state = {
      ...this.state,
      corporateTax: {
        state: 'registered',
        trn: params.trn,
        registeredOn: params.registeredOn,
        deregisteredOn: null,
      },
      financialYear: params.financialYear,
    };
    this.record(
      domainEvent('clients.client.corporate_tax_registered', this.id, params.now, {
        clientId: this.id,
        trn: params.trn.value,
        yearEndMonth: params.financialYear.endMonth,
      }),
    );
    return ok(true);
  }

  /**
   * Deregister. The number and the dates are kept, because the filings made
   * while registered still exist and still carry it.
   */
  deregisterFromVat(on: Date, now: Date): Result<true, Conflict> {
    if (this.state.vat.state !== 'registered') {
      return err(new Conflict('This client is not registered for VAT'));
    }
    this.state = {
      ...this.state,
      vat: { ...this.state.vat, state: 'deregistered', deregisteredOn: on },
    };
    this.record(
      domainEvent('clients.client.vat_deregistered', this.id, now, { clientId: this.id }),
    );
    return ok(true);
  }

  changeRate(change: RateChange, now: Date): Result<true, Conflict> {
    const updated = this.state.rates.add(change);
    if (!updated.ok) return err(new Conflict(updated.error.message, updated.error.details));

    this.state = { ...this.state, rates: updated.value };
    this.record(
      domainEvent('clients.client.rate_changed', this.id, now, {
        clientId: this.id,
        // The amount, not the whole rate object, so the audit entry reads
        // plainly six months later.
        perHour: change.rate.perHour.toMajorString(),
        currency: change.rate.currency,
        effectiveFrom: change.effectiveFrom.toISOString(),
      }),
    );
    return ok(true);
  }

  /** The rate to bill at for work done on a date (FR-03). */
  rateOn(date: Date, firmDefault: Rate): Rate {
    return this.state.rates.currentAt(date, firmDefault);
  }

  markDormant(now: Date): void {
    if (this.state.status !== 'active') return;
    this.state = { ...this.state, status: 'dormant' };
    this.record(domainEvent('clients.client.went_dormant', this.id, now, { clientId: this.id }));
  }

  reactivate(now: Date): void {
    if (this.state.status === 'active') return;
    this.state = { ...this.state, status: 'active' };
    this.record(domainEvent('clients.client.reactivated', this.id, now, { clientId: this.id }));
  }

  snapshot(): ClientState {
    return this.state;
  }
}
