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
