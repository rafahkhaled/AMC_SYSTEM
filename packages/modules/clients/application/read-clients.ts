import type { ClientDetail, ClientSummary, DocumentSummary, TaskSummary } from '@amc/contracts';
import { type Clock } from '@amc/kernel';
import { scopeFor } from '../domain/index.js';
import type { CallerLike, ClientRepository, DocumentRepository } from './ports.js';

/**
 * As much of a caller as a read needs.
 *
 * Reads decide what somebody may see and write nothing, so they have no audit
 * row to name and no business demanding a display name. The use cases that do
 * write take the whole `CallerLike`.
 */
type Viewer = Pick<CallerLike, 'userId' | 'permissions'>;
/** Supplied by the composition root, because tasks belong to another module. */
export interface TaskSummaryReader {
  forClient(clientId: string, scope: ReturnType<typeof scopeFor>): Promise<TaskSummary[]>;
  openCountsByClient(scope: ReturnType<typeof scopeFor>): Promise<Map<string, number>>;
}

/**
 * Everything the client screens read.
 *
 * The scope is derived here, from the caller's permissions, rather than passed
 * in by a controller. That keeps the one decision about who sees what in a
 * single place that every route goes through.
 */
export class ReadClients {
  constructor(
    private readonly clients: ClientRepository,
    private readonly documents: DocumentRepository,
    private readonly tasks: TaskSummaryReader,
    private readonly clock: Clock,
  ) {}

  async list(caller: Viewer, limit?: number): Promise<ClientSummary[]> {
    const scope = scopeFor(caller);
    const summaries = await this.clients.list(scope, limit ? { limit } : {});
    const openTasks = await this.tasks.openCountsByClient(scope);
    const today = this.clock.now();

    return Promise.all(
      summaries.map(async (summary) => {
        const documents = await this.documents.currentFor(summary.id, scope);
        return {
          id: summary.id,
          legalName: summary.legalName,
          legalNameArabic: null,
          status: summary.status as ClientSummary['status'],
          vatState: summary.vatState as ClientSummary['vatState'],
          vatTrn: summary.vatTrn,
          ctState: 'not_registered' as const,
          // What needs attention, which is the only reason a list column earns
          // its place.
          documentsExpiring: documents.filter((document) =>
            ['expiring', 'expired'].includes(document.expiryStateOn(today)),
          ).length,
          openTasks: openTasks.get(summary.id) ?? 0,
        };
      }),
    );
  }

  async detail(caller: CallerLike, clientId: string): Promise<ClientDetail | null> {
    const scope = scopeFor(caller);
    const client = await this.clients.findById(clientId, scope);
    if (!client) return null;

    const today = this.clock.now();
    const state = client.snapshot();
    const documents = await this.documents.currentFor(clientId, scope);
    const tasks = await this.tasks.forClient(clientId, scope);

    const documentSummaries: DocumentSummary[] = documents.map((document) => {
      const detail = document.snapshot();
      return {
        id: document.id,
        type: detail.type,
        status: detail.status,
        expiresOn: detail.expiresOn?.toISOString().slice(0, 10) ?? null,
        expiryState: document.expiryStateOn(today),
        daysUntilExpiry: document.daysUntilExpiry(today),
        originalName: detail.originalName,
      };
    });

    const currentRate = state.rates.on(today);

    return {
      id: client.id,
      legalName: state.legalName,
      legalNameArabic: state.legalNameArabic,
      status: state.status,
      vatState: state.vat.state,
      vatTrn: state.vat.trn?.value ?? null,
      ctState: state.corporateTax.state,
      ctTrn: state.corporateTax.trn?.value ?? null,
      tradeLicenceNumber: state.tradeLicenceNumber,
      // Staggered per client, so the screen shows which months rather than
      // implying everyone files on calendar quarters.
      vatPeriodEndMonths: state.vatPeriods?.endMonths() ?? [],
      financialYearEndMonth: state.financialYear?.endMonth ?? null,
      currentRate: currentRate?.perHour.toMajorString() ?? null,
      rateHistory: state.rates.all.map((change) => ({
        perHour: change.rate.perHour.toMajorString(),
        currency: change.rate.currency,
        effectiveFrom: change.effectiveFrom.toISOString().slice(0, 10),
        note: change.note ?? null,
      })),
      documents: documentSummaries,
      tasks,
      documentsExpiring: documentSummaries.filter((document) =>
        ['expiring', 'expired'].includes(document.expiryState),
      ).length,
      openTasks: tasks.filter((task) => !['completed', 'cancelled'].includes(task.state)).length,
    };
  }
}
