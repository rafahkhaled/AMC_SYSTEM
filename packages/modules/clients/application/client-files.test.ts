import {
  Conflict,
  type EventCollector,
  type UnitOfWork,
  type UnitOfWorkContext,
  ok,
} from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import type { ClientFile } from '../domain/index.js';
import { type ClientFileStore, ClientFiles } from './client-files.js';
import type { CallerLike, ClientFileRepository, StoredClientFile } from './ports.js';

const manager = {
  userId: 'u-1',
  displayName: 'Wael Ajam',
  roles: ['manager'],
  permissions: ['clients.view.all', 'clients.edit'],
} as unknown as CallerLike;

const accountant = {
  userId: 'u-2',
  displayName: 'Layla',
  roles: ['accountant'],
  permissions: ['clients.view.assigned', 'clients.edit'],
} as unknown as CallerLike;

const stranger = {
  userId: 'u-9',
  displayName: 'Nobody',
  roles: [],
  permissions: [],
} as unknown as CallerLike;

function harness() {
  const rows = new Map<string, ClientFile>();
  const events: string[] = [];
  const written: string[] = [];
  /** Which clients each user may reach. The manager reaches all of them. */
  const reach: Record<string, string[] | 'all'> = { 'u-1': 'all', 'u-2': ['c-1'] };
  const canSee = (userId: string, clientId: string) => {
    const mine = reach[userId];
    return mine === 'all' || (mine?.includes(clientId) ?? false);
  };

  const repository = (): ClientFileRepository => ({
    canReach: async (clientId, scope) =>
      scope.kind === 'all' || (scope.kind === 'assigned' && canSee(scope.userId, clientId)),
    forClient: async (clientId, scope) => {
      const allowed =
        scope.kind === 'all' || (scope.kind === 'assigned' && canSee(scope.userId, clientId));
      if (!allowed) return [];
      return [...rows.values()]
        .filter((file) => file.clientId === clientId && !file.isRemoved)
        .map((file): StoredClientFile => ({ file, uploadedByName: 'Wael Ajam' }));
    },
    findById: async (id, scope) => {
      const file = rows.get(id);
      if (!file) return null;
      const allowed =
        scope.kind === 'all' || (scope.kind === 'assigned' && canSee(scope.userId, file.clientId));
      return allowed ? file : null;
    },
    save: async (file) => {
      for (const event of file.pullEvents()) events.push(event.name);
      rows.set(file.id, file);
    },
  });

  const unitOfWork = {
    run: async (_actor: unknown, work: (context: UnitOfWorkContext) => Promise<unknown>) =>
      work({} as UnitOfWorkContext),
  } as unknown as UnitOfWork;

  const store: ClientFileStore = {
    put: async ({ clientId, fileId, filename }) => {
      written.push(filename);
      return ok({
        storageKey: `clients/${clientId}/files/${fileId}`,
        checksum: 'sum',
        contentType: 'application/octet-stream',
      });
    },
    linkTo: async (key, name) => `https://files.test/${key}?name=${name}`,
  };

  let next = 0;
  const files = new ClientFiles(
    unitOfWork,
    { forTransaction: (_db: unknown, _collector: EventCollector) => repository() },
    repository(),
    store,
    { next: () => `f-${++next}` },
  );
  return { files, rows, events, written };
}

const upload = (filename: string, size = 100) => ({
  filename,
  contentType: 'application/octet-stream',
  body: Buffer.alloc(size, 1),
});

describe('uploading to a client’s folder', () => {
  it('keeps several files at once and lists them', async () => {
    const h = harness();
    const outcome = await h.files.upload(manager, 'c-1', [upload('a.xlsx'), upload('b.docx')]);

    expect(outcome.ok && outcome.value.kept).toBe(2);
    expect((await h.files.list(manager, 'c-1')).map((file) => file.name).sort()).toEqual([
      'a.xlsx',
      'b.docx',
    ]);
    expect(h.events).toEqual(['clients.file.uploaded', 'clients.file.uploaded']);
  });

  it('keeps the good ones when one is refused, and says which and why', async () => {
    // Twelve statements and a program: the eleven are kept, the program is
    // named, and nobody has to start again from nothing.
    const h = harness();
    const outcome = await h.files.upload(manager, 'c-1', [
      upload('one.pdf'),
      upload('setup.exe'),
      upload('two.pdf'),
    ]);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.kept).toBe(2);
    expect(outcome.value.refused).toEqual([
      { name: 'setup.exe', reason: expect.stringContaining('programs are not kept') },
    ]);
  });

  it('never writes a refused file to storage', async () => {
    const h = harness();
    await h.files.upload(manager, 'c-1', [upload('setup.exe'), upload('empty.txt', 0)]);
    expect(h.written).toEqual([]);
  });

  it('is a refusal when nothing at all was kept', async () => {
    const h = harness();
    const outcome = await h.files.upload(manager, 'c-1', [upload('x.exe')]);
    expect(outcome.ok).toBe(false);
  });

  it('refuses a client the caller cannot reach, before storing anything', async () => {
    const h = harness();
    // The accountant is assigned to c-1 only.
    const outcome = await h.files.upload(accountant, 'c-2', [upload('a.pdf')]);

    expect(outcome.ok).toBe(false);
    expect(h.written).toEqual([]);
    expect(h.rows.size).toBe(0);
  });

  it('shows an unreachable client’s folder as empty, not as forbidden', async () => {
    const h = harness();
    await h.files.upload(manager, 'c-2', [upload('secret.pdf')]);

    expect(await h.files.list(accountant, 'c-2')).toEqual([]);
    expect(await h.files.list(stranger, 'c-2')).toEqual([]);
  });
});

describe('downloading and removing', () => {
  async function kept() {
    const h = harness();
    await h.files.upload(manager, 'c-1', [upload('statement.xlsx')]);
    const [file] = await h.files.list(manager, 'c-1');
    if (!file) throw new Error('nothing kept');
    return { h, id: file.id };
  }

  it('hands out a link that downloads under the name it was uploaded as', async () => {
    const { h, id } = await kept();
    expect(await h.files.linkTo(manager, id)).toContain('name=statement.xlsx');
  });

  it('gives a stranger the same answer as for a file that does not exist', async () => {
    const { h, id } = await kept();
    expect(await h.files.linkTo(stranger, id)).toBeNull();
    expect(await h.files.linkTo(manager, 'no-such-id')).toBeNull();
  });

  it('takes a file out of the folder and stops serving it, keeping the record', async () => {
    const { h, id } = await kept();
    h.events.length = 0;

    const removed = await h.files.remove(manager, id);
    expect(removed.ok).toBe(true);
    expect(await h.files.list(manager, 'c-1')).toEqual([]);
    expect(await h.files.linkTo(manager, id)).toBeNull();
    expect(h.rows.has(id)).toBe(true);
    expect(h.events).toEqual(['clients.file.removed']);
  });

  it('will not let somebody remove a file in a client they cannot reach', async () => {
    const h = harness();
    await h.files.upload(manager, 'c-2', [upload('theirs.pdf')]);
    const [file] = await h.files.list(manager, 'c-2');

    const refused = await h.files.remove(accountant, file?.id ?? '');
    expect(refused.ok).toBe(false);
    expect(refused).toMatchObject({ error: expect.any(Conflict) });
    expect(await h.files.list(manager, 'c-2')).toHaveLength(1);
  });

  it('cannot be removed twice', async () => {
    const { h, id } = await kept();
    await h.files.remove(manager, id);
    expect((await h.files.remove(manager, id)).ok).toBe(false);
  });
});
