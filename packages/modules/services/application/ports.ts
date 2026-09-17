import type { ServiceCode, Task, TaskId } from '../domain/index.js';

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
export type TaskScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'assigned'; readonly userId: string }
  | { readonly kind: 'none' };

export interface TaskRepository {
  findById(id: TaskId, scope: TaskScope): Promise<Task | null>;
  forClient(clientId: string, scope: TaskScope): Promise<Task[]>;
  /** The board: what is open, soonest due first. */
  open(scope: TaskScope, options?: { limit?: number }): Promise<Task[]>;
  /**
   * Whether this period has already been dealt with. The recurrence engine
   * asks before creating, so replaying it after an outage is harmless.
   */
  existsForPeriod(clientServiceId: string, periodKey: string): Promise<boolean>;
  save(task: Task): Promise<void>;
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
