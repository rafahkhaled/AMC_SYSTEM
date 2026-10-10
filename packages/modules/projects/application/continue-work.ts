import {
  Conflict,
  type EventCollector,
  type IdGenerator,
  type Result,
  type UnitOfWork,
  actorFrom,
  domainEvent,
  err,
  ok,
} from '@amc/kernel';
import { Project } from '../domain/index.js';
import type {
  CallerLike,
  ClientServiceRepository,
  ProjectRepository,
  ServiceCatalogue,
} from './ports.js';
import { scopeFor } from './project-workflow.js';
import { type ClientCycle, nextPeriod } from './recurrence.js';

export interface ContinuationRepositories {
  readonly projects: ProjectRepository;
  readonly subscriptions: ClientServiceRepository;
}

export interface ContinuationRepositoryFactory {
  forTransaction(db: unknown, collector: EventCollector): ContinuationRepositories;
}

/**
 * A client's own filing cycles, for the one client a person is looking at.
 *
 * Supplied from outside, like the sweep's: this module is told the shape of a
 * client's year and does not read the clients tables to find out.
 */
export interface ClientCycleReader {
  cycleFor(clientId: string): Promise<ClientCycle | undefined>;
}

/**
 * What happens when a recurring job is finished (feedback item 9).
 *
 * The sweep opens work for the period that has just closed, on its own. That
 * leaves two things a person has to be able to decide at the moment they
 * finish one: carry straight on with the next, which the sweep will not make
 * for weeks, or say this was a one-off and stop it coming round again.
 *
 * Both are about the *subscription* as much as the project. "One-time" is not
 * a flag on the finished project; it is the client no longer being engaged for
 * that service, which is what the sweep reads — so ending it is what stops
 * the next one appearing, and there is no second place to remember.
 */
export class ContinueWork {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repositories: ContinuationRepositoryFactory,
    private readonly catalogue: ServiceCatalogue,
    private readonly cycles: ClientCycleReader,
    private readonly ids: IdGenerator,
  ) {}

  /** Opens the period after this one now, rather than when the sweep would. */
  async openNext(
    caller: CallerLike,
    projectId: string,
  ): Promise<Result<{ projectId: string }, Conflict>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const { projects } = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );

      const finished = await this.finishedRecurring(caller, projects, projectId);
      if (!finished.ok) return err(finished.error);
      const { project, recurrence } = finished.value;
      const state = project.snapshot();

      if (state.periodKey === null) {
        return err(new Conflict('That job has no period, so there is no next one to open'));
      }

      const next = nextPeriod(
        recurrence,
        state.periodKey,
        await this.cycles.cycleFor(state.clientId),
        new Date(),
      );
      if (!next) {
        return err(
          new Conflict(
            'The next period cannot be worked out from what is on file for this client; start it from New work',
          ),
        );
      }

      // The same test the sweep makes, so a project opened by hand and the one
      // the sweep would have opened are one project and never two.
      if (await projects.existsForPeriod(state.clientServiceId, next.key)) {
        return err(new Conflict(`${next.key} is already open for this client`));
      }

      const template = await this.catalogue.find(state.service);
      /*
       * Opened even when they have stopped it repeating. Choosing to carry on
       * with the next one is a decision about this period; whether the sweep
       * should keep doing it unprompted is a separate one, and answering one
       * should not silently change the other.
       */
      const created = Project.fromTemplate({
        id: this.ids.next(),
        clientId: state.clientId,
        clientServiceId: state.clientServiceId,
        service: state.service,
        ...(template ? { template } : {}),
        periodKey: next.key,
        dueAt: next.dueAt,
        now: new Date(),
      });
      await projects.save(created);
      return ok({ projectId: created.id });
    });
  }

  /** This was a one-time job: stop it coming round again. */
  stopRepeating(caller: CallerLike, projectId: string): Promise<Result<true, Conflict>> {
    return this.toggle(caller, projectId, 'stop');
  }

  /** Changed their mind: carry on repeating. */
  resumeRepeating(caller: CallerLike, projectId: string): Promise<Result<true, Conflict>> {
    return this.toggle(caller, projectId, 'resume');
  }

  private toggle(
    caller: CallerLike,
    projectId: string,
    direction: 'stop' | 'resume',
  ): Promise<Result<true, Conflict>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const { projects, subscriptions } = this.repositories.forTransaction(
        (context as unknown as { db: unknown }).db,
        context,
      );

      const finished = await this.finishedRecurring(caller, projects, projectId);
      if (!finished.ok) return err(finished.error);
      const state = finished.value.project.snapshot();

      const live = (await subscriptions.activeFor(state.clientId)).find(
        (one) => one.service === state.service,
      );
      const now = new Date();

      if (direction === 'stop') {
        if (!live) return err(new Conflict('This is already stopped from repeating'));
        /*
         * Never on the day it began. The table refuses an end date that is not
         * after the start, and "started and stopped the same afternoon" is a
         * real thing to do while correcting a mistake.
         */
        const earliest = new Date(live.activeFrom.getTime() + 86_400_000);
        await subscriptions.end(live.id, now > earliest ? now : earliest);
        context.collect([
          domainEvent('services.subscription.stopped', live.id, now, {
            clientId: state.clientId,
            service: state.service,
            becauseOfProject: state.id,
          }),
        ]);
        return ok(true as const);
      }

      if (live) return err(new Conflict('This is already repeating'));
      const resumed = await subscriptions.subscribe({
        id: this.ids.next(),
        clientId: state.clientId,
        service: state.service,
        activeFrom: now,
      });
      context.collect([
        domainEvent('services.subscription.resumed', resumed.id, now, {
          clientId: state.clientId,
          service: state.service,
          becauseOfProject: state.id,
        }),
      ]);
      return ok(true as const);
    });
  }

  /**
   * A finished job of a service that comes round again, or a reason it is not.
   *
   * Out of scope reads as not there, like every other project lookup.
   */
  private async finishedRecurring(
    caller: CallerLike,
    projects: ProjectRepository,
    projectId: string,
  ): Promise<
    Result<
      { project: Project; recurrence: 'monthly' | 'per_vat_period' | 'per_financial_year' },
      Conflict
    >
  > {
    const project = await projects.findById(projectId, scopeFor(caller));
    if (!project) return err(new Conflict('No such project'));

    if (project.snapshot().state !== 'completed') {
      return err(new Conflict('Only a finished job can be carried on or stopped'));
    }

    const template = await this.catalogue.find(project.service);
    if (!template || template.recurrence === 'once') {
      // A one-off service has nothing to repeat, so there is nothing to carry
      // on with and nothing to stop. Said plainly rather than a button that
      // does nothing.
      return err(new Conflict('That service is done once, so it does not repeat'));
    }
    return ok({ project, recurrence: template.recurrence });
  }
}
