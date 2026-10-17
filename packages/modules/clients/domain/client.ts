import {
  AggregateRoot,
  Conflict,
  Rate,
  type Result,
  domainEvent,
  err,
  ok,
  toE164,
} from '@amc/kernel';
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
  readonly contactPerson: string | null;
  readonly contactEmail: string | null;
  readonly mobile: string | null;
  readonly landline: string | null;
  /** 0 is Sunday, 6 is Saturday. */
  readonly weeklyDayOff: number | null;
  readonly address: string | null;
  /** "HH:MM", both or neither. */
  readonly opensAt: string | null;
  readonly closesAt: string | null;
  readonly status: ClientStatus;
  readonly vat: TaxRegistration;
  readonly corporateTax: TaxRegistration;
  readonly vatPeriods: VatPeriods | null;
  readonly financialYear: FinancialYear | null;
  readonly rates: RateHistory;
  readonly onboardedOn: Date;
  readonly notes: string | null;
}

/**
 * What can be changed about a client's details in one go.
 *
 * `undefined` leaves a field as it is and `null` clears it, so a form can send
 * only what the person touched.
 */
export interface ClientDetailsChange {
  readonly tradeLicenceNumber?: string | null;
  readonly contactPerson?: string | null;
  readonly contactEmail?: string | null;
  readonly mobile?: string | null;
  readonly landline?: string | null;
  readonly weeklyDayOff?: number | null;
  readonly address?: string | null;
  /** "HH:MM". Both, or neither: hours with one end are not hours. */
  readonly opensAt?: string | null;
  readonly closesAt?: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const blank = (value: string | null): string | null => value?.trim() || null;

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
      contactPerson: null,
      contactEmail: null,
      mobile: null,
      landline: null,
      weeklyDayOff: null,
      address: null,
      opensAt: null,
      closesAt: null,
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

  /**
   * Change the details the firm keeps about reaching and identifying a client.
   *
   * Phone numbers are checked by reading them, the same way an inbound
   * WhatsApp number is, so what is stored can be matched against one later.
   * The event names the fields that changed and not their values: an audit
   * row is for who changed what, and should not become a second copy of a
   * client's phone number.
   */
  changeDetails(change: ClientDetailsChange, now: Date): Result<true, Conflict> {
    const next = { ...this.state };
    const changed: string[] = [];
    const set = <K extends keyof ClientDetailsChange>(
      key: K,
      value: ClientState[K & keyof ClientState],
    ) => {
      if (this.state[key as keyof ClientState] !== value) {
        (next as Record<string, unknown>)[key] = value;
        changed.push(key);
      }
    };

    if (change.tradeLicenceNumber !== undefined) {
      set('tradeLicenceNumber', blank(change.tradeLicenceNumber));
    }
    if (change.contactPerson !== undefined) set('contactPerson', blank(change.contactPerson));
    if (change.contactEmail !== undefined) {
      const email = blank(change.contactEmail);
      if (email && !EMAIL.test(email)) return err(new Conflict('That is not an email address'));
      set('contactEmail', email);
    }
    for (const key of ['mobile', 'landline'] as const) {
      const given = change[key];
      if (given === undefined) continue;
      const number = blank(given);
      if (number && toE164(number) === null) {
        return err(new Conflict(`The ${key} number could not be read as a phone number`));
      }
      set(key, number);
    }
    if (change.weeklyDayOff !== undefined) {
      const day = change.weeklyDayOff;
      if (day !== null && (!Number.isInteger(day) || day < 0 || day > 6)) {
        return err(new Conflict('The weekly day off is a day of the week'));
      }
      set('weeklyDayOff', day);
    }

    if (change.address !== undefined) set('address', blank(change.address));
    if (change.opensAt !== undefined || change.closesAt !== undefined) {
      const opens = blank(change.opensAt === undefined ? this.state.opensAt : change.opensAt);
      const closes = blank(change.closesAt === undefined ? this.state.closesAt : change.closesAt);
      if ((opens === null) !== (closes === null)) {
        return err(new Conflict('Give both the opening and the closing time, or neither'));
      }
      for (const time of [opens, closes]) {
        if (time !== null && !TIME.test(time)) {
          return err(new Conflict('Times are written like 08:30'));
        }
      }
      if (opens !== null && closes !== null && closes <= opens) {
        return err(new Conflict('Closing time has to be after opening time'));
      }
      set('opensAt', opens);
      set('closesAt', closes);
    }

    if (changed.length === 0) return ok(true);
    this.state = next;
    this.record(
      domainEvent('clients.client.details_changed', this.id, now, {
        clientId: this.id,
        fields: changed,
      }),
    );
    return ok(true);
  }

  /** The firm's own reference numbers for this client were replaced. */
  noteReferencesChanged(labels: readonly string[], now: Date): void {
    this.record(
      domainEvent('clients.client.references_changed', this.id, now, {
        clientId: this.id,
        labels,
      }),
    );
  }

  /** A TRN typed wrongly, corrected. Registration state and dates are untouched. */
  correctTrn(tax: 'vat' | 'corporate_tax', trn: Trn, now: Date): Result<true, Conflict> {
    const key = tax === 'vat' ? 'vat' : 'corporateTax';
    const current = this.state[key];
    if (current.state === 'not_registered') {
      return err(new Conflict('This client is not registered, so there is no number to correct'));
    }
    if (current.trn?.value === trn.value) return ok(true);
    this.state = { ...this.state, [key]: { ...current, trn } };
    this.record(
      domainEvent('clients.client.trn_corrected', this.id, now, {
        clientId: this.id,
        tax,
        from: current.trn?.value ?? null,
        to: trn.value,
      }),
    );
    return ok(true);
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
