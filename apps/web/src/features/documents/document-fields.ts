/**
 * What each kind of document asks for.
 *
 * One form for every type used to ask for the same "reference number" and
 * "issued by" whatever was being filed. The firm asked for the fields a person
 * actually reads off the paper: a licence has a licence number and an issuing
 * authority, an Emirates ID has an ID number and nothing to choose about who
 * issued it, and a tenancy contract has an address, not an authority.
 */
export interface DocumentFields {
  /** The translation key for the number printed on it, or null for none. */
  readonly number: string | null;
  /** Whether "issued by" means anything for this type. */
  readonly authority: boolean;
  /** Whether it is tied to a place, so the address is asked for. */
  readonly address: boolean;
}

const BY_TYPE: Readonly<Record<string, DocumentFields>> = {
  trade_licence: { number: 'documents.numbers.licence', authority: true, address: false },
  emirates_id: { number: 'documents.numbers.emiratesId', authority: false, address: false },
  passport: { number: 'documents.numbers.passport', authority: false, address: false },
  visa: { number: 'documents.numbers.visa', authority: false, address: false },
  memorandum: { number: null, authority: true, address: false },
  tenancy_contract: { number: 'documents.numbers.contract', authority: false, address: true },
  vat_certificate: { number: 'documents.numbers.trn', authority: false, address: false },
  corporate_tax_certificate: { number: 'documents.numbers.trn', authority: false, address: false },
  bank_letter: { number: null, authority: false, address: false },
};

/** A type the firm added itself gets the general fields. */
const GENERAL: DocumentFields = {
  number: 'documents.numbers.reference',
  authority: true,
  address: false,
};

export function fieldsFor(type: string): DocumentFields {
  return BY_TYPE[type] ?? GENERAL;
}

/** Which document types carry an expiry date the renewal reminders hang on. */
export const EXPIRES = new Set([
  'trade_licence',
  'emirates_id',
  'passport',
  'visa',
  'tenancy_contract',
]);

/**
 * A guess at the type from the file's name, so a folder of scans named
 * "EID_…", "TL.pdf" and "Ejari.pdf" lands mostly right without six clicks.
 * Only a starting point; the person can change it before uploading.
 */
export function guessType(filename: string, available: readonly string[]): string | null {
  const name = filename.toLowerCase();
  const rules: [RegExp, string][] = [
    [/(^|[^a-z])(eid|emirates[\s_-]*id)/, 'emirates_id'],
    [/passport|جواز/, 'passport'],
    [/visa|اقامة|إقامة/, 'visa'],
    [/ejari|tenancy|lease|ايجار|إيجار/, 'tenancy_contract'],
    [/(^|[^a-z])(tl|licen[cs]e)([^a-z]|$)|رخصة/, 'trade_licence'],
    [/moa|memorandum|تأسيس/, 'memorandum'],
    [/corporate|(^|[^a-z])ct([^a-z]|$)/, 'corporate_tax_certificate'],
    [/vat|trn/, 'vat_certificate'],
    [/bank/, 'bank_letter'],
  ];
  for (const [pattern, type] of rules) {
    if (pattern.test(name) && available.includes(type)) return type;
  }
  return null;
}
