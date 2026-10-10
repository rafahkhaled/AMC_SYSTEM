import { describe, expect, it } from 'vitest';
import {
  ALL_SERVICES,
  Project,
  type ProjectId,
  defineCustomService,
  templateFor,
} from '../domain/index.js';
import type {
  ClientService,
  ClientServiceRepository,
  ProjectRepository,
  ProjectScope,
  ServiceCatalogue,
} from './ports.js';
import { StartProject } from './start-project.js';

const NOW = new Date('2026-10-01T08:00:00.000Z');
const ALL: ProjectScope = { kind: 'all' };
const clock = { now: () => NOW };

class Ids {
  private count = 0;
  next = () => `id-${++this.count}`;
}

class Projects implements ProjectRepository {
  readonly saved: Project[] = [];
  constructor(private readonly existing: Project[] = []) {}

  async forClient(clientId: string): Promise<Project[]> {
    return this.existing.filter((project) => project.clientId === clientId);
  }
  async existsForPeriod(clientServiceId: string, periodKey: string): Promise<boolean> {
    return this.existing.some((project) => {
      const state = project.snapshot();
      return state.clientServiceId === clientServiceId && state.periodKey === periodKey;
    });
  }
  async save(project: Project): Promise<void> {
    this.saved.push(project);
  }
  findById = async (): Promise<Project | null> => null;
  open = async (): Promise<Project[]> => [];
}

class Services implements ClientServiceRepository {
  readonly created: ClientService[] = [];
  constructor(private readonly existing: ClientService[] = []) {}

  async activeFor(clientId: string): Promise<ClientService[]> {
    return this.existing.filter((one) => one.clientId === clientId);
  }
  async subscribe(params: {
    id: string;
    clientId: string;
    service: ClientService['service'];
    activeFrom: Date;
  }): Promise<ClientService> {
    const made = { ...params, activeTo: null };
    this.created.push(made);
    this.existing.push(made);
    return made;
  }
  allActive = async (): Promise<ClientService[]> => [];
  end = async (): Promise<void> => undefined;
}

const engaged = (over: Partial<ClientService> = {}): ClientService => ({
  id: 'cs-1',
  clientId: 'c-1',
  service: 'deregistration',
  activeFrom: new Date('2026-01-01T00:00:00.000Z'),
  activeTo: null,
  ...over,
});

/** The eleven in code and nothing else, which is what most of these tests are about. */
const catalogue: ServiceCatalogue = {
  find: async (code) => templateFor(code) ?? null,
  offered: async () => [...ALL_SERVICES],
  retired: async () => [],
};

function existingProject(over: { service?: ClientService['service']; closed?: boolean } = {}) {
  const project = Project.fromTemplate({
    id: 'p-old' as ProjectId,
    clientId: 'c-1',
    clientServiceId: 'cs-1',
    service: over.service ?? 'deregistration',
    now: NOW,
  });
  // Cancelled rather than completed: a de-registration cannot reach
  // in_progress until its mandatory documents arrive, and both states are
  // ends as far as "is there already one open" is concerned.
  if (over.closed) project.moveTo('cancelled', NOW);
  return project;
}

describe('starting a one-off piece of work', () => {
  it('opens work for a service the client is not yet engaged for', async () => {
    const projects = new Projects();
    const services = new Services();
    const start = new StartProject(projects, services, clock, new Ids(), catalogue);

    const result = await start.execute({
      clientId: 'c-1',
      service: 'deregistration',
      scope: ALL,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    /*
     * The engagement is created too. A project hangs off a client_service and
     * not off a client, and asking for a de-registration *is* taking the
     * engagement on — refusing until somebody creates it separately would put
     * a piece of admin between a phone call and the work.
     */
    expect(services.created).toHaveLength(1);
    expect(services.created[0]?.service).toBe('deregistration');
    expect(projects.saved).toHaveLength(1);
    expect(result.value.service).toBe('deregistration');
  });

  it('reuses the engagement the client already has', async () => {
    const services = new Services([engaged()]);
    const start = new StartProject(new Projects(), services, clock, new Ids(), catalogue);

    const result = await start.execute({
      clientId: 'c-1',
      service: 'deregistration',
      scope: ALL,
    });

    expect(result.ok).toBe(true);
    // One live subscription per client per service; the schema enforces it too.
    expect(services.created).toHaveLength(0);
    if (result.ok) expect(result.value.snapshot().clientServiceId).toBe('cs-1');
  });

  it('refuses a second open project for the same service', async () => {
    const projects = new Projects([existingProject()]);
    const start = new StartProject(
      projects,
      new Services([engaged()]),
      clock,
      new Ids(),
      catalogue,
    );

    const result = await start.execute({
      clientId: 'c-1',
      service: 'deregistration',
      scope: ALL,
    });

    // Two people taking the same phone call is the realistic mistake, and
    // handing back the other one silently is how both believe they started it.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('already an open');
    expect(projects.saved).toHaveLength(0);
  });

  it('allows a new one once the last is closed', async () => {
    const projects = new Projects([existingProject({ closed: true })]);
    const start = new StartProject(
      projects,
      new Services([engaged()]),
      clock,
      new Ids(),
      catalogue,
    );

    // A client can be de-registered for VAT this year and for CT the next.
    const result = await start.execute({
      clientId: 'c-1',
      service: 'deregistration',
      scope: ALL,
    });
    expect(result.ok).toBe(true);
  });

  it('carries the template’s documents and tasks', async () => {
    const start = new StartProject(new Projects(), new Services(), clock, new Ids(), catalogue);
    const result = await start.execute({
      clientId: 'c-1',
      service: 'vat_registration',
      scope: ALL,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const state = result.value.snapshot();
    expect(state.tasks.length).toBeGreaterThan(0);
    // Work that needs papers starts by asking for them, not by looking ready.
    expect(state.requirements.length).toBeGreaterThan(0);
    expect(state.state).toBe('awaiting_documents');
  });

  it('takes a due date when the caller knows one', async () => {
    const start = new StartProject(new Projects(), new Services(), clock, new Ids(), catalogue);
    const due = new Date('2026-12-31T00:00:00.000Z');
    const result = await start.execute({
      clientId: 'c-1',
      service: 'penalty_waiver',
      dueAt: due,
      scope: ALL,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.snapshot().dueAt).toEqual(due);
  });

  it('refuses a period the sweep has already covered', async () => {
    const projects = new Projects([
      Project.fromTemplate({
        id: 'p-old' as ProjectId,
        clientId: 'c-1',
        clientServiceId: 'cs-1',
        service: 'vat_return',
        periodKey: '2026-Q3',
        now: NOW,
      }),
    ]);
    const services = new Services([engaged({ service: 'vat_return' })]);
    const start = new StartProject(projects, services, clock, new Ids(), catalogue);

    const result = await start.execute({
      clientId: 'c-1',
      service: 'vat_return',
      periodKey: '2026-Q3',
      scope: ALL,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('already has a project');
  });

  it('says nothing is there when the caller cannot see the client', async () => {
    const start = new StartProject(new Projects(), new Services(), clock, new Ids(), catalogue);
    const result = await start.execute({
      clientId: 'c-1',
      service: 'deregistration',
      scope: { kind: 'none' },
    });

    // Not "forbidden": a refusal would confirm the client exists.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('not there');
  });
});

describe('starting a service the firm added (feedback item 8)', () => {
  const trademark = defineCustomService('custom_trademark', {
    nameEn: 'Trademark registration',
    nameAr: 'تسجيل علامة تجارية',
    deadlineDays: 45,
    steps: [{ nameEn: 'File', nameAr: 'تقديم' }],
    requiredDocuments: [],
  });
  if (!trademark.ok) throw trademark.error;
  const withCustom: ServiceCatalogue = {
    ...catalogue,
    find: async (code) =>
      code === 'custom_trademark' ? trademark.value : (templateFor(code) ?? null),
  };

  it('opens a project with its own steps, and engages the client for it', async () => {
    const projects = new Projects();
    const services = new Services();
    const start = new StartProject(projects, services, clock, new Ids(), withCustom);

    const started = await start.execute({
      clientId: 'c-1',
      service: 'custom_trademark',
      scope: ALL,
    });

    expect(started.ok).toBe(true);
    expect(services.created[0]?.service).toBe('custom_trademark');
    expect(projects.saved[0]?.tasksRemaining).toBe(1);
    // Nothing mandatory to wait for, so it can begin straight away.
    expect(projects.saved[0]?.status).toBe('ready');
  });

  it('dates it from the service’s own deadline when nobody typed one', async () => {
    const projects = new Projects();
    const start = new StartProject(projects, new Services(), clock, new Ids(), withCustom);

    await start.execute({ clientId: 'c-1', service: 'custom_trademark', scope: ALL });

    // 45 days from the first of October.
    expect(projects.saved[0]?.snapshot().dueAt?.toISOString()).toBe('2026-11-15T08:00:00.000Z');
  });

  it('prefers the date somebody typed', async () => {
    const projects = new Projects();
    const start = new StartProject(projects, new Services(), clock, new Ids(), withCustom);
    const typed = new Date('2026-10-20T00:00:00.000Z');

    await start.execute({ clientId: 'c-1', service: 'custom_trademark', dueAt: typed, scope: ALL });

    expect(projects.saved[0]?.snapshot().dueAt).toEqual(typed);
  });

  it('leaves a manual-deadline service undated', async () => {
    const projects = new Projects();
    const start = new StartProject(projects, new Services(), clock, new Ids(), catalogue);

    await start.execute({ clientId: 'c-1', service: 'penalty_waiver', scope: ALL });

    // The authority sets these case by case.
    expect(projects.saved[0]?.snapshot().dueAt).toBeNull();
  });

  it('refuses a service the catalogue has never heard of', async () => {
    const start = new StartProject(new Projects(), new Services(), clock, new Ids(), withCustom);
    const refused = await start.execute({ clientId: 'c-1', service: 'custom_ghost', scope: ALL });

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('not one of the services');
  });
});
