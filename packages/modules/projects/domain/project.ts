import { AggregateRoot, Conflict, type Result, domainEvent, err, ok } from '@amc/kernel';
import { type ServiceCode, mandatoryDocumentsFor, templateFor } from './service-template.js';

export type ProjectId = string;

/**
 * Where a piece of work has got to (FR-12).
 *
 * The two waiting states are separate on purpose. Waiting for a client and
 * waiting for the authority look the same on a board but mean entirely
 * different things: one is chased by the practice, the other cannot be
 * hurried, and a report that merges them tells the manager nothing about which
 * work is actually stuck on their side.
 */
export type ProjectState =
  | 'awaiting_documents'
  | 'ready'
  | 'in_progress'
  | 'waiting_for_client'
  | 'waiting_for_authority'
  | 'completed'
  | 'cancelled';

/**
 * What may follow what.
 *
 * An explicit table rather than scattered conditions, so the whole lifecycle
 * can be read in one place and an impossible move is a typed failure rather
 * than a state nobody expected.
 */
const ALLOWED: Readonly<Record<ProjectState, readonly ProjectState[]>> = {
  awaiting_documents: ['ready', 'cancelled'],
  ready: ['in_progress', 'awaiting_documents', 'cancelled'],
  in_progress: ['waiting_for_client', 'waiting_for_authority', 'completed', 'cancelled'],
  waiting_for_client: ['in_progress', 'cancelled'],
  waiting_for_authority: ['in_progress', 'completed', 'cancelled'],
  // Both are ends. Work that resumes after completion is new work, and a
  // reopened project would quietly detach the hours already invoiced against it.
  completed: [],
  cancelled: [],
};

/** One of the template's document requirements, and whether it has been met. */
export interface ProjectRequirement {
  readonly type: string;
  readonly mandatory: boolean;
  /** The client document supplying it, once one has been attached. */
  readonly documentId: string | null;
}

export interface TaskProgress {
  readonly order: number;
  readonly doneAt: Date | null;
}

export interface ProjectState_ {
  readonly id: ProjectId;
  readonly clientId: string;
  readonly clientServiceId: string;
  readonly service: ServiceCode;
  /** Which period this instance is for; null for work that happens once. */
  readonly periodKey: string | null;
  readonly state: ProjectState;
  readonly dueAt: Date | null;
  readonly requirements: readonly ProjectRequirement[];
  readonly tasks: readonly TaskProgress[];
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
}

export class Project extends AggregateRoot<ProjectId> {
  private constructor(private state: ProjectState_) {
    super(state.id);
  }

  static rehydrate(state: ProjectState_): Project {
    return new Project(state);
  }

  /**
   * Create a project from its template (FR-11).
   *
   * It starts awaiting documents when any are mandatory, and ready when none
   * are. Starting everything at "ready" would mean the board shows work as
   * available that cannot actually be begun.
   */
  static fromTemplate(params: {
    id: ProjectId;
    clientId: string;
    clientServiceId: string;
    service: ServiceCode;
    periodKey?: string | null;
    dueAt?: Date | null;
    now: Date;
  }): Project {
    const template = templateFor(params.service);
    const requirements = template.requiredDocuments.map((required) => ({
      type: required.type,
      mandatory: required.mandatory,
      documentId: null,
    }));

    const project = new Project({
      id: params.id,
      clientId: params.clientId,
      clientServiceId: params.clientServiceId,
      service: params.service,
      periodKey: params.periodKey ?? null,
      state: requirements.some((requirement) => requirement.mandatory)
        ? 'awaiting_documents'
        : 'ready',
      dueAt: params.dueAt ?? null,
      requirements,
      tasks: template.tasks.map((task) => ({ order: task.order, doneAt: null })),
      startedAt: null,
      completedAt: null,
      createdAt: params.now,
    });

    project.record(
      domainEvent('services.project.created', params.id, params.now, {
        projectId: params.id,
        clientId: params.clientId,
        service: params.service,
        periodKey: params.periodKey ?? null,
        dueAt: params.dueAt?.toISOString() ?? null,
      }),
    );
    return project;
  }

  get clientId(): string {
    return this.state.clientId;
  }

  get service(): ServiceCode {
    return this.state.service;
  }

  get periodKey(): string | null {
    return this.state.periodKey;
  }

  get status(): ProjectState {
    return this.state.state;
  }

  get dueAt(): Date | null {
    return this.state.dueAt;
  }

  get requirements(): readonly ProjectRequirement[] {
    return this.state.requirements;
  }

  /** The mandatory documents still missing. Empty means the work can start. */
  get missingDocuments(): string[] {
    return this.state.requirements
      .filter((requirement) => requirement.mandatory && requirement.documentId === null)
      .map((requirement) => requirement.type);
  }

  get isBlocked(): boolean {
    return this.missingDocuments.length > 0;
  }

  /**
   * Attach one of the client's documents to this project (ERD rule 1).
   *
   * The project is the link between a client and their documents: this is what
   * lets a project reach exactly the right files rather than the whole
   * repository. Satisfying the last mandatory requirement moves the project to
   * ready on its own, because a person should not have to notice.
   */
  attachDocument(type: string, documentId: string, now: Date): Result<true, Conflict> {
    const requirement = this.state.requirements.find((candidate) => candidate.type === type);
    if (!requirement) {
      return err(new Conflict('This service does not ask for that document', { type }));
    }
    if (requirement.documentId === documentId) return ok(true);

    this.state = {
      ...this.state,
      requirements: this.state.requirements.map((candidate) =>
        candidate.type === type ? { ...candidate, documentId } : candidate,
      ),
    };

    this.record(
      domainEvent('services.project.document_attached', this.id, now, {
        projectId: this.id,
        clientId: this.state.clientId,
        documentId,
        type,
      }),
    );

    if (this.state.state === 'awaiting_documents' && !this.isBlocked) {
      this.transitionTo('ready', now);
    }
    return ok(true);
  }

  /** Remove a document, which can put the project back to awaiting documents. */
  detachDocument(type: string, now: Date): Result<true, Conflict> {
    const requirement = this.state.requirements.find((candidate) => candidate.type === type);
    if (!requirement?.documentId)
      return err(new Conflict('No such document is attached', { type }));
    if (this.state.state === 'completed') {
      return err(new Conflict('A completed project keeps the documents it was done with'));
    }

    this.state = {
      ...this.state,
      requirements: this.state.requirements.map((candidate) =>
        candidate.type === type ? { ...candidate, documentId: null } : candidate,
      ),
    };

    this.record(
      domainEvent('services.project.document_detached', this.id, now, {
        projectId: this.id,
        type,
        documentId: requirement.documentId,
      }),
    );

    if (this.isBlocked && this.state.state === 'ready') {
      this.transitionTo('awaiting_documents', now);
    }
    return ok(true);
  }

  /**
   * Begin the work.
   *
   * This is the gate from FR-12, and it is a rule of the domain rather than a
   * disabled button. Work that starts without the paperwork produces a return
   * that cannot be filed and hours that cannot be billed.
   */
  start(now: Date): Result<true, Conflict> {
    if (this.isBlocked) {
      return err(
        new Conflict('The documents this work needs are not all here yet', {
          missing: this.missingDocuments,
        }),
      );
    }
    return this.moveTo('in_progress', now);
  }

  /**
   * What this project may move to next.
   *
   * Read from the same table the move itself checks, so a screen can never
   * offer a button the domain would refuse. There is one account of the
   * lifecycle, not one for the rules and another for the buttons.
   */
  allowedNext(): readonly ProjectState[] {
    return ALLOWED[this.state.state];
  }

  moveTo(next: ProjectState, now: Date): Result<true, Conflict> {
    if (!ALLOWED[this.state.state].includes(next)) {
      return err(
        new Conflict(`This work cannot go from ${this.state.state} to ${next}`, {
          from: this.state.state,
          to: next,
        }),
      );
    }
    if (next === 'in_progress' && this.isBlocked) {
      return err(
        new Conflict('The documents this work needs are not all here yet', {
          missing: this.missingDocuments,
        }),
      );
    }
    this.transitionTo(next, now);
    return ok(true);
  }

  completeTask(order: number, now: Date): Result<true, Conflict> {
    const task = this.state.tasks.find((candidate) => candidate.order === order);
    if (!task) return err(new Conflict('No such task', { order }));
    if (task.doneAt) return err(new Conflict('That task is already done', { order }));

    this.state = {
      ...this.state,
      tasks: this.state.tasks.map((candidate) =>
        candidate.order === order ? { ...candidate, doneAt: now } : candidate,
      ),
    };
    this.record(
      domainEvent('services.project.task_completed', this.id, now, {
        projectId: this.id,
        order,
        remaining: this.tasksRemaining,
      }),
    );
    return ok(true);
  }

  get tasksRemaining(): number {
    return this.state.tasks.filter((task) => task.doneAt === null).length;
  }

  /** Whether the due date has passed, which the board colours by. */
  isOverdueAt(now: Date): boolean {
    if (!this.state.dueAt || this.state.state === 'completed' || this.state.state === 'cancelled') {
      return false;
    }
    return now.getTime() > this.state.dueAt.getTime();
  }

  setDueAt(dueAt: Date, now: Date): void {
    this.state = { ...this.state, dueAt };
    this.record(
      domainEvent('services.project.due_date_set', this.id, now, {
        projectId: this.id,
        dueAt: dueAt.toISOString(),
      }),
    );
  }

  private transitionTo(next: ProjectState, now: Date): void {
    const from = this.state.state;
    this.state = {
      ...this.state,
      state: next,
      startedAt: next === 'in_progress' && !this.state.startedAt ? now : this.state.startedAt,
      completedAt: next === 'completed' ? now : this.state.completedAt,
    };
    this.record(
      domainEvent('services.project.state_changed', this.id, now, {
        projectId: this.id,
        clientId: this.state.clientId,
        service: this.state.service,
        from,
        to: next,
      }),
    );
  }

  snapshot(): ProjectState_ {
    return this.state;
  }
}

export { mandatoryDocumentsFor };
