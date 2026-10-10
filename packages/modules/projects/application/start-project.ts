import { type Clock, Conflict, type IdGenerator, type Result, err, ok } from '@amc/kernel';
import { Project, type ServiceCode, type ServiceTemplate } from '../domain/index.js';
import type {
  ClientServiceRepository,
  ProjectRepository,
  ProjectScope,
  ServiceCatalogue,
} from './ports.js';

/**
 * Starting a piece of work by hand (FR-10, FR-11).
 *
 * The recurrence sweep creates the repeating work — VAT returns, CT returns —
 * and it returns early for a template whose recurrence is `once`. So the
 * one-off services in the firm's list of eleven, a de-registration or a
 * penalty waiver or a VAT refund, had no way to come into existence at all:
 * a client would phone asking for one and there was nothing to open.
 *
 * This is that path. It is not a second way to create recurring work by
 * accident — a period that already has a project is refused, and so is a
 * second open project for the same service, which is the realistic mistake:
 * two people taking the same phone call.
 */
export class StartProject {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly services: ClientServiceRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly catalogue: ServiceCatalogue,
  ) {}

  async execute(params: {
    clientId: string;
    service: ServiceCode;
    dueAt?: Date | null;
    periodKey?: string | null;
    scope: ProjectScope;
  }): Promise<Result<Project, Conflict>> {
    // Out of scope reads as not there, the way it does everywhere else: a
    // refusal would confirm the client exists to somebody who may not see it.
    if (params.scope.kind === 'none') {
      return err(new Conflict('That client is not there'));
    }

    const template = await this.catalogue.find(params.service);
    if (!template) {
      return err(new Conflict('That is not one of the services the firm offers'));
    }
    const now = this.clock.now();

    const periodKey = params.periodKey ?? null;
    if (periodKey !== null) {
      const subscriptions = await this.services.activeFor(params.clientId);
      const existing = subscriptions.find((one) => one.service === params.service);
      if (existing && (await this.projects.existsForPeriod(existing.id, periodKey))) {
        return err(new Conflict('That period already has a project'));
      }
    }

    const open = (await this.projects.forClient(params.clientId, params.scope)).filter(
      (project) =>
        project.service === params.service &&
        project.snapshot().state !== 'completed' &&
        project.snapshot().state !== 'cancelled',
    );
    if (open.length > 0 && periodKey === null) {
      /*
       * Refused rather than silently returning the existing one.
       *
       * Handing back the project somebody else opened looks like success and
       * is how two people end up believing they each started the work. The
       * message names it so whoever asked can go and look.
       */
      return err(new Conflict(`There is already an open ${template.nameEn} for this client`));
    }

    /*
     * The client has to be engaged for the service before work can hang off
     * it, because a project belongs to a client_service and not to a client.
     * Starting a de-registration is itself the act of taking that engagement
     * on, so this creates the subscription rather than refusing and asking
     * somebody to go and create it first.
     */
    const subscription =
      (await this.services.activeFor(params.clientId)).find(
        (one) => one.service === params.service,
      ) ??
      (await this.services.subscribe({
        id: this.ids.next(),
        clientId: params.clientId,
        service: params.service,
        activeFrom: now,
      }));

    const project = Project.fromTemplate({
      id: this.ids.next(),
      clientId: params.clientId,
      clientServiceId: subscription.id,
      service: params.service,
      template,
      periodKey,
      // The date somebody typed wins; failing that, the template's own rule
      // for a fixed number of days. A rule the firm wrote down is not a guess,
      // and without this the "deadline in days" on a service would be a number
      // that nothing reads.
      dueAt: params.dueAt ?? dueFromTemplate(template, now),
      now,
    });
    await this.projects.save(project);
    return ok(project);
  }
}

/** Days from the day it starts, where the template says so; otherwise left for somebody to date. */
function dueFromTemplate(template: ServiceTemplate, from: Date): Date | null {
  if (template.deadline.kind !== 'days_from_start') return null;
  return new Date(from.getTime() + template.deadline.days * 86_400_000);
}
