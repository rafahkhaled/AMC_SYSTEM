import type { BoardProject, ProjectBoard, ProjectDetail } from '@amc/contracts';
import { type Clock, heldBy } from '@amc/kernel';
import type { Project, ProjectState } from '../domain/index.js';
import type {
  CallerLike,
  ClientServiceRepository,
  ProjectRepository,
  ProjectScope,
  ServiceCatalogue,
} from './ports.js';

/**
 * As much of a caller as a read needs.
 *
 * Reads decide what somebody may see and write nothing, so they have no audit
 * row to name and no business demanding a display name. The use cases that do
 * write take the whole `CallerLike`.
 */
type Viewer = Pick<CallerLike, 'userId' | 'permissions'>;
/**
 * Names and hours that live outside this module.
 *
 * A project knows its client's id, not the company's name, and it knows nothing
 * at all about recorded time. Both are supplied by the composition root rather
 * than reached for, which is what keeps the modules from depending on each
 * other's tables.
 */
export interface ProjectContextReader {
  clientNames(clientIds: readonly string[]): Promise<Map<string, string>>;
  assignees(
    projectIds: readonly string[],
  ): Promise<Map<string, { userId: string; displayName: string; role: string }[]>>;
  recordedSeconds(projectIds: readonly string[]): Promise<Map<string, number>>;
  /** Current documents on a client's file, for satisfying a requirement. */
  documentsFor(
    clientId: string,
  ): Promise<{ id: string; type: string; name: string; expiresOn: Date | null }[]>;
}

/**
 * The columns, in the order the work moves through them.
 *
 * Completed and cancelled are absent on purpose. A board is what is still to
 * be done; finished work belongs in a report, where it can be filtered by date
 * rather than growing without limit down the side of the screen.
 */
const COLUMNS: readonly ProjectState[] = [
  'awaiting_documents',
  'ready',
  'in_progress',
  'waiting_for_client',
  'waiting_for_authority',
];

export class ReadProjects {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly context: ProjectContextReader,
    private readonly clock: Clock,
    private readonly catalogue: ServiceCatalogue,
    private readonly subscriptions: ClientServiceRepository,
  ) {}

  /**
   * Who may see what.
   *
   * `projects.view.all` is the manager's view. Anyone else sees the work they are
   * assigned to, and someone with neither sees an empty board rather than an
   * error, for the same reason an out-of-scope client reads as not found.
   */
  private scope(caller: Viewer): ProjectScope {
    const held = heldBy(caller);
    if (held.has('projects.view.all')) return { kind: 'all' };
    if (held.has('time.record') || held.has('projects.edit')) {
      return { kind: 'assigned', userId: caller.userId };
    }
    return { kind: 'none' };
  }

  async board(caller: Viewer): Promise<ProjectBoard> {
    const open = await this.projects.open(this.scope(caller));
    const summaries = await this.decorate(open);

    return {
      columns: COLUMNS.map((state) => ({
        state,
        projects: summaries.filter((project) => project.state === state),
      })),
    };
  }

  async detail(caller: Viewer, id: string): Promise<ProjectDetail | null> {
    const project = await this.projects.findById(id, this.scope(caller));
    if (!project) return null;

    const [summary] = await this.decorate([project]);
    if (!summary) return null;

    const template = await this.catalogue.find(project.service);
    const documents = await this.context.documentsFor(project.clientId);
    const byId = new Map(documents.map((document) => [document.id, document]));
    const snapshot = project.snapshot();

    return {
      ...summary,
      requirements: project.requirements.map((requirement) => {
        const document = requirement.documentId ? byId.get(requirement.documentId) : undefined;
        return {
          type: requirement.type,
          mandatory: requirement.mandatory,
          documentId: requirement.documentId,
          documentName: document?.name ?? null,
          documentExpiresOn: document?.expiresOn?.toISOString() ?? null,
        };
      }),
      tasks: snapshot.tasks.map((task) => {
        const named = template?.tasks.find((candidate) => candidate.order === task.order);
        return {
          order: task.order,
          titleEn: named?.nameEn ?? `Task ${task.order}`,
          titleAr: named?.nameAr ?? `خطوة ${task.order}`,
          dueOn: task.dueOn?.toISOString().slice(0, 10) ?? null,
          doneAt: task.doneAt?.toISOString() ?? null,
        };
      }),
      continuation: await this.continuation(project, template?.recurrence ?? 'once'),
      allowedTransitions: [...project.allowedNext()],
      backwardTransitions: project.allowedNext().filter((next) => project.goingBack(next)),
      availableDocuments: documents.map((document) => ({
        id: document.id,
        type: document.type,
        expiresOn: document.expiresOn?.toISOString() ?? null,
      })),
      startedAt: snapshot.startedAt?.toISOString() ?? null,
      completedAt: snapshot.completedAt?.toISOString() ?? null,
    };
  }

  /** Attaches the names and totals that live in other modules, in one pass. */
  /**
   * Whether somebody can now carry on with, or stop, a recurring job.
   *
   * Only for a finished job of a service that comes round again. A one-off has
   * nothing to repeat and an open job is not yet the moment to decide.
   */
  private async continuation(
    project: Project,
    recurrence: string,
  ): Promise<{ repeating: boolean } | null> {
    const state = project.snapshot();
    if (state.state !== 'completed' || recurrence === 'once') return null;

    const live = await this.subscriptions.activeFor(state.clientId);
    return { repeating: live.some((one) => one.service === state.service) };
  }

  private async decorate(
    projects: readonly import('../domain/index.js').Project[],
  ): Promise<BoardProject[]> {
    if (projects.length === 0) return [];

    const now = this.clock.now();
    const ids = projects.map((project) => project.id);
    const [names, assignees, seconds] = await Promise.all([
      this.context.clientNames([...new Set(projects.map((project) => project.clientId))]),
      this.context.assignees(ids),
      this.context.recordedSeconds(ids),
    ]);

    return projects.map((project) => ({
      id: project.id,
      clientId: project.clientId,
      clientName: names.get(project.clientId) ?? '',
      service: project.service,
      periodKey: project.periodKey,
      state: project.status,
      dueAt: project.dueAt?.toISOString() ?? null,
      isOverdue: project.isOverdueAt(now),
      missingDocuments: project.missingDocuments,
      assignees: assignees.get(project.id) ?? [],
      recordedSeconds: seconds.get(project.id) ?? 0,
    }));
  }
}
