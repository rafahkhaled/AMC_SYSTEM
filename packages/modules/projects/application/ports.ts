import type { Project, ProjectId, ServiceCode, ServiceTemplate } from '../domain/index.js';

/** A client's subscription to one service. */
export interface ClientService {
  readonly id: string;
  readonly clientId: string;
  readonly service: ServiceCode;
  readonly activeFrom: Date;
  readonly activeTo: Date | null;
}

/**
 * Which clients may be seen, passed down from the caller.
 *
 * The same shape the clients module uses, redeclared rather than imported: a
 * module never reaches into another module's domain, and this is a value not
 * a behaviour.
 */
export type ProjectScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'assigned'; readonly userId: string }
  | { readonly kind: 'none' };

export interface ProjectRepository {
  findById(id: ProjectId, scope: ProjectScope): Promise<Project | null>;
  forClient(clientId: string, scope: ProjectScope): Promise<Project[]>;
  /** The board: what is open, soonest due first. */
  open(scope: ProjectScope, options?: { limit?: number }): Promise<Project[]>;
  /**
   * Whether this period has already been dealt with. The recurrence engine
   * asks before creating, so replaying it after an outage is harmless.
   */
  existsForPeriod(clientServiceId: string, periodKey: string): Promise<boolean>;
  save(project: Project): Promise<void>;
}

export interface ClientServiceRepository {
  activeFor(clientId: string): Promise<ClientService[]>;
  /** Every live subscription to one service, for the recurrence sweep. */
  allActive(service: ServiceCode): Promise<ClientService[]>;
  subscribe(params: {
    id: string;
    clientId: string;
    service: ServiceCode;
    activeFrom: Date;
  }): Promise<ClientService>;
  end(id: string, on: Date): Promise<void>;
}

/** The caller. Re-exported so modules import their ports, not the kernel. */
export type { CallerLike } from '@amc/kernel';

/**
 * Every service the firm offers: the eleven in code, and the ones it added.
 *
 * A port because the second kind lives in the database, and the domain and
 * the use cases are not allowed to go and fetch it themselves.
 */
export interface ServiceCatalogue {
  /** Retired ones included: a project opened under one still has to show its steps. */
  find(code: ServiceCode): Promise<ServiceTemplate | null>;
  /** Retired ones excluded, in the order the firm wants them offered. */
  offered(): Promise<ServiceTemplate[]>;
  /** The ones taken out of the picker. Screens still need their names. */
  retired(): Promise<ServiceTemplate[]>;
}
