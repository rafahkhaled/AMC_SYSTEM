import type { Conflict, IdGenerator, Result } from '@amc/kernel';
import { Conflict as ConflictError, err, ok } from '@amc/kernel';
import { type LetterFacts, placeholdersIn, scopeFor } from '../domain/index.js';
import type { CallerLike, ClientRepository, LetterRepository } from './ports.js';

export interface TemplateView {
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  /** Which facts this letter needs, so a preview can say what is missing. */
  readonly needs: string[];
}

export interface LetterView {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly language: 'en' | 'ar';
  readonly createdAt: string;
  /** Facts the letter wanted and the client record could not supply. */
  readonly missing: string[];
}

/**
 * What the firm signs its own name as. Configuration rather than a client
 * fact, so it is supplied rather than looked up.
 */
export interface FirmDetails {
  readonly name: string;
  readonly signatory: string;
}

/**
 * Letters, filled in from the client's own record (FR-15).
 *
 * Today these are Word files somebody copies and edits by hand, which is how
 * a letter goes out with the previous client's name still in it. Nothing here
 * is clever: the point is that the name, the licence number and the tax
 * number come from the record rather than from a person's memory.
 *
 * The rendered letter is stored rather than regenerated on demand. A letter is
 * a thing that was sent, and reproducing it next year from today's template
 * and today's client record would produce a different letter and call it the
 * same one.
 */
export class GenerateLetter {
  constructor(
    private readonly letters: LetterRepository,
    private readonly clients: ClientRepository,
    private readonly firm: FirmDetails,
    private readonly ids: IdGenerator,
  ) {}

  private scope(caller: CallerLike) {
    const held =
      caller.permissions instanceof Set ? caller.permissions : new Set(caller.permissions);
    return scopeFor(held, caller.userId);
  }

  async templates(): Promise<TemplateView[]> {
    const found = await this.letters.templates();
    return found.map((template) => {
      const state = template.snapshot();
      return {
        code: state.code,
        nameEn: state.nameEn,
        nameAr: state.nameAr,
        // Both languages' bodies, since a template may mention a fact in one
        // and not the other and the preview should warn about either.
        needs: [...new Set([...placeholdersIn(state.bodyEn), ...placeholdersIn(state.bodyAr)])],
      };
    });
  }

  async history(caller: CallerLike, clientId: string): Promise<LetterView[]> {
    const client = await this.clients.findById(clientId, this.scope(caller));
    if (!client) return [];

    const letters = await this.letters.forClient(clientId);
    return letters.map((letter) => ({
      id: letter.id,
      title: letter.title,
      body: letter.body,
      language: letter.language,
      createdAt: letter.createdAt.toISOString(),
      missing: [],
    }));
  }

  async generate(
    caller: CallerLike,
    params: {
      clientId: string;
      templateCode: string;
      language: 'en' | 'ar';
      taskId?: string | undefined;
    },
  ): Promise<Result<LetterView, Conflict>> {
    const client = await this.clients.findById(params.clientId, this.scope(caller));
    // Out of scope and non-existent give the same answer.
    if (!client) return err(new ConflictError('No such client'));

    const template = await this.letters.templateByCode(params.templateCode);
    if (!template || template.isRetired) return err(new ConflictError('No such letter'));

    const facts = this.factsFor(client);
    const rendered = template.render(params.language, facts);

    /*
     * What the letter asked for and the record could not give. Returned rather
     * than refused: a letter with a gap in it is often exactly what somebody
     * wants — they are about to write the number in by hand — and refusing
     * would send them back to a Word file.
     */
    const needed = placeholdersIn(
      params.language === 'ar' ? template.snapshot().bodyAr : template.snapshot().bodyEn,
    );
    const missing = needed.filter((name) => {
      const value = facts[name];
      return !value || value.trim().length === 0;
    });

    const letter = {
      id: this.ids.next(),
      clientId: params.clientId,
      templateId: template.id,
      taskId: params.taskId ?? null,
      language: params.language,
      title: rendered.title,
      body: rendered.body,
      generatedBy: caller.userId,
      createdAt: new Date(),
    };
    await this.letters.record(letter);

    return ok({
      id: letter.id,
      title: letter.title,
      body: letter.body,
      language: letter.language,
      createdAt: letter.createdAt.toISOString(),
      missing,
    });
  }

  /** What this system knows about a client that a letter might want. */
  private factsFor(client: {
    snapshot(): {
      legalName: string;
      legalNameArabic?: string | null;
      tradeLicenceNumber?: string | null;
      vatTrn?: { value: string } | string | null;
      ctTrn?: { value: string } | string | null;
    };
  }): LetterFacts {
    const state = client.snapshot();
    const trn = (value: { value: string } | string | null | undefined): string | null =>
      typeof value === 'string' ? value : (value?.value ?? null);

    /*
     * Only facts that are actually known go in. A key present with an empty
     * value and a key that is absent mean the same thing here — the letter
     * shows its gap either way — but leaving it out keeps `missing` honest.
     */
    const known: Record<string, string> = {
      client_name: state.legalName,
      today: new Date().toISOString().slice(0, 10),
      firm_name: this.firm.name,
      signatory: this.firm.signatory,
    };

    const optional: [string, string | null | undefined][] = [
      ['client_name_arabic', state.legalNameArabic],
      ['trade_licence', state.tradeLicenceNumber],
      ['vat_trn', trn(state.vatTrn)],
      ['ct_trn', trn(state.ctTrn)],
    ];
    for (const [name, value] of optional) {
      if (value && value.trim().length > 0) known[name] = value;
    }

    return known as LetterFacts;
  }
}
