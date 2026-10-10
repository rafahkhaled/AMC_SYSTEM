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
  type CustomServiceInput,
  type ServiceTemplate,
  codeFor,
  defineCustomService,
  isCustomServiceCode,
} from '../domain/index.js';
import type { CallerLike } from './ports.js';

/** A service the firm added, with what the screen needs to show it. */
export interface StoredService {
  readonly template: ServiceTemplate;
  readonly deadlineDays: number | null;
  readonly retired: boolean;
}

/** What may be changed. Every field optional, and each may be passed as undefined. */
export interface ServiceChanges {
  readonly nameEn?: string | undefined;
  readonly nameAr?: string | undefined;
  readonly deadlineDays?: number | null | undefined;
  readonly steps?: CustomServiceInput['steps'] | undefined;
  readonly requiredDocuments?: CustomServiceInput['requiredDocuments'] | undefined;
  readonly retired?: boolean | undefined;
}

export interface CustomServiceRepository {
  all(): Promise<StoredService[]>;
  find(code: string): Promise<StoredService | null>;
  insert(params: {
    template: ServiceTemplate;
    deadlineDays: number | null;
    position: number;
    createdBy: string;
  }): Promise<void>;
  update(params: {
    template: ServiceTemplate;
    deadlineDays: number | null;
    retired: boolean;
  }): Promise<void>;
}

export interface CustomServiceRepositoryFactory {
  forTransaction(db: unknown, collector: EventCollector): CustomServiceRepository;
}

/**
 * Which document types may be listed as required.
 *
 * Supplied from outside because they are an administrator-edited list that
 * lives in the clients module's reference data, and this module does not reach
 * into another module's tables.
 */
export interface DocumentTypeLookup {
  /** Codes that exist, retired ones included. */
  known(): Promise<ReadonlySet<string>>;
}

/**
 * Adding to the firm's services (feedback item 8).
 *
 * Every change is a domain event, so the unit of work writes the audit row in
 * the same transaction: who added a service, and who changed what it asks for,
 * is the kind of thing somebody asks months later.
 */
export class ManageServices {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repositories: CustomServiceRepositoryFactory,
    private readonly documentTypes: DocumentTypeLookup,
    private readonly builtInCodes: ReadonlySet<string>,
  ) {}

  async add(caller: CallerLike, input: CustomServiceInput): Promise<Result<string, Conflict>> {
    const unknown = await this.unknownDocuments(input);
    if (unknown) return err(unknown);

    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const repository = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );

      const existing = await repository.all();
      const taken = new Set([...this.builtInCodes, ...existing.map((one) => one.template.code)]);
      const code = codeFor(input.nameEn, taken);
      if (!code.ok) return err(code.error);

      const template = defineCustomService(code.value, input);
      if (!template.ok) return err(template.error);

      await repository.insert({
        template: template.value,
        deadlineDays: input.deadlineDays,
        position: existing.length,
        createdBy: caller.userId,
      });
      context.collect([
        domainEvent('services.service.added', code.value, new Date(), {
          code: code.value,
          nameEn: template.value.nameEn,
          steps: template.value.tasks.length,
          documents: template.value.requiredDocuments.length,
        }),
      ]);
      return ok(code.value);
    });
  }

  async change(
    caller: CallerLike,
    code: string,
    changes: ServiceChanges,
  ): Promise<Result<true, Conflict>> {
    if (!isCustomServiceCode(code)) {
      // The eleven in code have deadline rules and recurrences the engine
      // understands; editing one from a screen would quietly change that.
      return err(new Conflict('Only a service the firm added can be changed here'));
    }

    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const repository = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );
      const current = await repository.find(code);
      if (!current) return err(new Conflict('No such service'));

      const before = current.template;
      const steps = changes.steps ?? before.tasks.map(({ nameEn, nameAr }) => ({ nameEn, nameAr }));
      if (steps.length < before.tasks.length) {
        /*
         * Never fewer than there were. A project already opened records
         * progress by step number, so removing step 2 would relabel
         * everything done against step 3 as something it was not.
         */
        return err(new Conflict('Steps can be renamed or added to, but not removed'));
      }

      const merged: CustomServiceInput = {
        nameEn: changes.nameEn ?? before.nameEn,
        nameAr: changes.nameAr ?? before.nameAr,
        deadlineDays:
          changes.deadlineDays !== undefined ? changes.deadlineDays : current.deadlineDays,
        steps,
        requiredDocuments: changes.requiredDocuments ?? before.requiredDocuments,
      };

      const unknown = await this.unknownDocuments(merged);
      if (unknown) return err(unknown);

      const template = defineCustomService(code, merged);
      if (!template.ok) return err(template.error);

      const retired = changes.retired ?? current.retired;
      await repository.update({
        template: template.value,
        deadlineDays: merged.deadlineDays,
        retired,
      });
      context.collect([
        domainEvent(
          retired === current.retired
            ? 'services.service.changed'
            : retired
              ? 'services.service.retired'
              : 'services.service.restored',
          code,
          new Date(),
          { code, nameEn: template.value.nameEn },
        ),
      ]);
      return ok(true as const);
    });
  }

  private async unknownDocuments(input: CustomServiceInput): Promise<Conflict | null> {
    const known = await this.documentTypes.known();
    const missing = input.requiredDocuments.filter((document) => !known.has(document.type));
    return missing.length === 0
      ? null
      : new Conflict(
          `Not a document type on the list: ${missing.map((one) => one.type).join(', ')}`,
        );
  }
}
