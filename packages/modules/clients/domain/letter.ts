import { Conflict, type Result, err, ok } from '@amc/kernel';

/**
 * What a letter can be told about the client it is for (FR-15).
 *
 * A closed set, deliberately. An open one — anything on the client record —
 * would mean a template could reference a field that is renamed next year and
 * silently produce a letter with a gap in it. These are the facts a letter
 * actually needs, and each has a fallback for when it is not known.
 */
export const PLACEHOLDERS = [
  'client_name',
  'client_name_arabic',
  'trade_licence',
  'vat_trn',
  'ct_trn',
  'today',
  'firm_name',
  'signatory',
] as const;

export type Placeholder = (typeof PLACEHOLDERS)[number];

export type LetterFacts = Readonly<Partial<Record<Placeholder, string>>>;

/**
 * What a placeholder says when nobody has filled it in.
 *
 * Never an empty string. A letter with a blank where the tax number should be
 * reads as finished and is not, and somebody signs it. A visible marker is
 * the thing that gets noticed before it goes out.
 */
const MISSING = '__________';

const PLACEHOLDER_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

/**
 * Fills a template with what is known about a client.
 *
 * The values are escaped for HTML, because a client's legal name is a value
 * somebody typed and a letter is rendered in a browser. A company called
 * `<script>` is unlikely and a company with an ampersand in its name is not.
 */
export function renderLetter(body: string, facts: LetterFacts): string {
  return body.replace(PLACEHOLDER_PATTERN, (whole, name: string) => {
    if (!(PLACEHOLDERS as readonly string[]).includes(name)) {
      // An unknown placeholder is left exactly as written rather than blanked.
      // Somebody proofreading sees `{{director_name}}` and knows what happened;
      // a silent deletion leaves a sentence with a hole in it.
      return whole;
    }
    const value = facts[name as Placeholder];
    return escapeHtml(value && value.trim().length > 0 ? value : MISSING);
  });
}

/** Which placeholders a template uses, for a preview to show what it needs. */
export function placeholdersIn(body: string): Placeholder[] {
  const found = new Set<Placeholder>();
  for (const match of body.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1];
    if (name && (PLACEHOLDERS as readonly string[]).includes(name)) {
      found.add(name as Placeholder);
    }
  }
  return [...found];
}

/**
 * Placeholders in a body that the system will not fill in.
 *
 * `renderLetter` leaves an unknown one exactly as written, which is right for a
 * letter being proofread and wrong for one being written: `{{client_nme}}` saved
 * today is a letter that goes to a client in six months with the braces still
 * in it. Asked when a template is saved, so the typo is found by the person who
 * made it.
 */
export function unknownPlaceholdersIn(body: string): string[] {
  const unknown = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1];
    if (name && !(PLACEHOLDERS as readonly string[]).includes(name)) unknown.add(name);
  }
  return [...unknown];
}

/**
 * A code out of the English name: `Salary certificate` becomes `salary_certificate`.
 *
 * Generated rather than typed, and never reused — a letter already produced
 * refers to its template by id, but the code is what the screens and the
 * history show.
 */
export function templateCodeFor(nameEn: string, taken: ReadonlySet<string>): string | null {
  const slug = nameEn
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  if (slug.length === 0) return null;
  if (!taken.has(slug)) return slug;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    if (!taken.has(`${slug}_${suffix}`)) return `${slug}_${suffix}`;
  }
  return null;
}

/**
 * Checks what somebody wrote before it becomes a template.
 *
 * Both languages are required, because the letter is generated in whichever the
 * client reads and a template missing one fails at the moment somebody needs it.
 * Placeholders must be ones the system fills in, in either language.
 */
export function checkTemplateWording(wording: {
  nameEn: string;
  nameAr: string;
  bodyEn: string;
  bodyAr: string;
}): Conflict | null {
  if (wording.nameEn.trim().length === 0 || wording.nameAr.trim().length === 0) {
    return new Conflict('Name the letter in both English and Arabic');
  }
  if (wording.bodyEn.trim().length === 0 || wording.bodyAr.trim().length === 0) {
    return new Conflict('A letter needs wording in both languages');
  }
  const unknown = [
    ...new Set([
      ...unknownPlaceholdersIn(wording.bodyEn),
      ...unknownPlaceholdersIn(wording.bodyAr),
    ]),
  ];
  if (unknown.length > 0) {
    return new Conflict(
      `The system cannot fill in ${unknown.map((name) => `{{${name}}}`).join(', ')}. Use one of: ${PLACEHOLDERS.map((name) => `{{${name}}}`).join(', ')}`,
    );
  }
  return null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface TemplateState {
  readonly id: string;
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly bodyEn: string;
  readonly bodyAr: string;
  readonly retiredAt: Date | null;
}

/** One of the firm's letters, in both languages. */
export class DocumentTemplate {
  private constructor(private readonly state: TemplateState) {}

  static rehydrate(state: TemplateState): DocumentTemplate {
    return new DocumentTemplate(state);
  }

  static of(params: Omit<TemplateState, 'retiredAt'>): Result<DocumentTemplate, Conflict> {
    if (params.bodyEn.trim().length === 0 || params.bodyAr.trim().length === 0) {
      return err(new Conflict('A letter needs wording in both languages'));
    }
    return ok(new DocumentTemplate({ ...params, retiredAt: null }));
  }

  get id(): string {
    return this.state.id;
  }

  get code(): string {
    return this.state.code;
  }

  get isRetired(): boolean {
    return this.state.retiredAt !== null;
  }

  /** The letter, filled in, in the language asked for. */
  render(language: 'en' | 'ar', facts: LetterFacts): { title: string; body: string } {
    const arabic = language === 'ar';
    return {
      title: arabic ? this.state.nameAr : this.state.nameEn,
      body: renderLetter(arabic ? this.state.bodyAr : this.state.bodyEn, facts),
    };
  }

  snapshot(): TemplateState {
    return this.state;
  }
}
