import type { LetterTemplateDetail } from '@amc/contracts';
import {
  Conflict,
  type EventCollector,
  type Result,
  type UnitOfWork,
  actorFrom,
  domainEvent,
  err,
  ok,
} from '@amc/kernel';
import {
  type TemplateState,
  checkTemplateWording,
  placeholdersIn,
  templateCodeFor,
} from '../domain/index.js';
import type { CallerLike } from './ports.js';

export interface LetterTemplateAdminRepository {
  /** Retired ones included, with the wording. */
  all(): Promise<TemplateState[]>;
  findByCode(code: string): Promise<TemplateState | null>;
  insert(template: TemplateState): Promise<void>;
  update(template: TemplateState): Promise<void>;
}

export interface LetterTemplateAdminRepositoryFactory {
  forTransaction(db: unknown, collector: EventCollector): LetterTemplateAdminRepository;
}

const detail = (state: TemplateState): LetterTemplateDetail => ({
  code: state.code,
  nameEn: state.nameEn,
  nameAr: state.nameAr,
  bodyEn: state.bodyEn,
  bodyAr: state.bodyAr,
  needs: [...new Set([...placeholdersIn(state.bodyEn), ...placeholdersIn(state.bodyAr)])],
  retired: state.retiredAt !== null,
});

/**
 * The firm's own letters (feedback item 6).
 *
 * Templates were seeded by a migration, so adding one or fixing a sentence
 * meant a developer. They are the firm's wording and it is theirs to change.
 *
 * Changing one changes only the letters generated from then on. A letter already
 * produced keeps the text it was produced with: it is a thing that was sent,
 * and regenerating it from today's wording would call a different letter the
 * same one.
 */
export class ManageLetterTemplates {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repositories: LetterTemplateAdminRepositoryFactory,
    private readonly reads: LetterTemplateAdminRepository,
    private readonly ids: { next(): string },
  ) {}

  async all(): Promise<LetterTemplateDetail[]> {
    return (await this.reads.all()).map(detail);
  }

  async add(
    caller: CallerLike,
    wording: { nameEn: string; nameAr: string; bodyEn: string; bodyAr: string },
  ): Promise<Result<string, Conflict>> {
    const refused = checkTemplateWording(wording);
    if (refused) return err(refused);

    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const repository = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );
      const taken = new Set((await repository.all()).map((one) => one.code));
      const code = templateCodeFor(wording.nameEn, taken);
      if (!code) return err(new Conflict('Give the English name using letters or numbers'));

      await repository.insert({
        id: this.ids.next(),
        code,
        nameEn: wording.nameEn.trim(),
        nameAr: wording.nameAr.trim(),
        bodyEn: wording.bodyEn,
        bodyAr: wording.bodyAr,
        retiredAt: null,
      });
      context.collect([
        domainEvent('clients.letter_template.added', code, new Date(), {
          code,
          nameEn: wording.nameEn.trim(),
        }),
      ]);
      return ok(code);
    });
  }

  async change(
    caller: CallerLike,
    code: string,
    changes: {
      nameEn?: string | undefined;
      nameAr?: string | undefined;
      bodyEn?: string | undefined;
      bodyAr?: string | undefined;
      retired?: boolean | undefined;
    },
  ): Promise<Result<true, Conflict>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const repository = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );
      const current = await repository.findByCode(code);
      if (!current) return err(new Conflict('No such letter'));

      const merged = {
        nameEn: changes.nameEn ?? current.nameEn,
        nameAr: changes.nameAr ?? current.nameAr,
        bodyEn: changes.bodyEn ?? current.bodyEn,
        bodyAr: changes.bodyAr ?? current.bodyAr,
      };
      const refused = checkTemplateWording(merged);
      if (refused) return err(refused);

      const now = new Date();
      const retiredNow =
        changes.retired === undefined
          ? current.retiredAt
          : changes.retired
            ? (current.retiredAt ?? now)
            : null;

      await repository.update({
        ...current,
        nameEn: merged.nameEn.trim(),
        nameAr: merged.nameAr.trim(),
        bodyEn: merged.bodyEn,
        bodyAr: merged.bodyAr,
        retiredAt: retiredNow,
      });

      const wasRetired = current.retiredAt !== null;
      const isRetired = retiredNow !== null;
      context.collect([
        domainEvent(
          wasRetired === isRetired
            ? 'clients.letter_template.changed'
            : isRetired
              ? 'clients.letter_template.retired'
              : 'clients.letter_template.restored',
          code,
          now,
          { code, nameEn: merged.nameEn.trim() },
        ),
      ]);
      return ok(true as const);
    });
  }
}
