import {
  Conflict,
  type EventCollector,
  type UnitOfWork,
  type UnitOfWorkContext,
  ok,
} from '@amc/kernel';
import { describe, expect, it } from 'vitest';
import type { ClientFile, ClientFolder } from '../domain/index.js';
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
  const folders = new Map<string, ClientFolder>();
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
    foldersFor: async (clientId, scope) => {
      const allowed =
        scope.kind === 'all' || (scope.kind === 'assigned' && canSee(scope.userId, clientId));
      if (!allowed) return [];
      return [...folders.values()]
        .filter((folder) => folder.clientId === clientId && !folder.isRemoved)
        .map((folder) => ({
          folder,
          fileCount: [...rows.values()].filter(
            (file) => file.folderId === folder.id && !file.isRemoved,
          ).length,
        }));
    },
    findFolder: async (id, scope) => {
      const folder = folders.get(id);
      if (!folder) return null;
      const allowed =
        scope.kind === 'all' ||
        (scope.kind === 'assigned' && canSee(scope.userId, folder.clientId));
      return allowed ? folder : null;
    },
    depthOf: async (id) => {
      let depth = 0;
      let at: string | null = id;
      while (at) {
        depth += 1;
        at = folders.get(at)?.parentId ?? null;
      }
      return depth;
    },
    nameTaken: async (clientId, parentId, name, exceptId) =>
      [...folders.values()].some(
        (folder) =>
          folder.clientId === clientId &&
          folder.parentId === parentId &&
          !folder.isRemoved &&
          folder.id !== exceptId &&
          folder.snapshot().name.toLowerCase() === name.toLowerCase(),
      ),
    folderHasContents: async (id) =>
      [...rows.values()].some((file) => file.folderId === id && !file.isRemoved) ||
      [...folders.values()].some((folder) => folder.parentId === id && !folder.isRemoved),
    saveFolder: async (folder) => {
      for (const event of folder.pullEvents()) events.push(event.name);
      folders.set(folder.id, folder);
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
  return { files, rows, folders, events, written };
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

describe('folders inside a client’s folder', () => {
  const made = async (
    h: ReturnType<typeof harness>,
    name: string,
    parent: string | null = null,
  ) => {
    const created = await h.files.createFolder(manager, 'c-1', name, parent);
    if (!created.ok) throw new Error(created.error.message);
    return created.value;
  };

  it('makes a folder, nests one inside it, and lists them with their parents', async () => {
    const h = harness();
    const year = await made(h, '2025');
    const statements = await made(h, 'Bank statements', year);

    const listed = await h.files.folders(manager, 'c-1');
    expect(listed.map((f) => [f.name, f.parentId])).toEqual(
      expect.arrayContaining([
        ['2025', null],
        ['Bank statements', year],
      ]),
    );
    expect(statements).toBeTruthy();
    expect(h.events).toEqual(['clients.folder.created', 'clients.folder.created']);
  });

  it('refuses a name that is empty, has a slash, or is already used in that place', async () => {
    const h = harness();
    await made(h, 'Audit');
    for (const name of ['', '   ', 'a/b', 'a\\b', '..']) {
      expect((await h.files.createFolder(manager, 'c-1', name, null)).ok).toBe(false);
    }
    const twice = await h.files.createFolder(manager, 'c-1', 'audit', null);
    expect(!twice.ok && twice.error.message).toContain('already a folder');
  });

  it('allows the same name in different places', async () => {
    const h = harness();
    const a = await made(h, '2024');
    await made(h, 'Invoices', a);
    const b = await made(h, '2025');
    expect((await h.files.createFolder(manager, 'c-1', 'Invoices', b)).ok).toBe(true);
  });

  it('will not nest past the limit', async () => {
    const h = harness();
    let parent: string | null = null;
    for (let level = 1; level <= 6; level += 1) parent = await made(h, `level ${level}`, parent);
    const tooDeep = await h.files.createFolder(manager, 'c-1', 'too deep', parent);
    expect(!tooDeep.ok && tooDeep.error.message).toContain('levels deep');
  });

  it('puts uploads in the folder asked for, and refuses a folder that is not there', async () => {
    const h = harness();
    const folder = await made(h, 'Statements');
    await h.files.upload(manager, 'c-1', [upload('jan.pdf')], folder);
    await h.files.upload(manager, 'c-1', [upload('top.pdf')]);

    const listed = await h.files.list(manager, 'c-1');
    expect(listed.find((f) => f.name === 'jan.pdf')?.folderId).toBe(folder);
    expect(listed.find((f) => f.name === 'top.pdf')?.folderId).toBeNull();
    expect((await h.files.folders(manager, 'c-1'))[0]?.fileCount).toBe(1);

    const stored = h.written.length;
    const refused = await h.files.upload(manager, 'c-1', [upload('x.pdf')], 'no-such-folder');
    expect(refused.ok).toBe(false);
    expect(h.written.length).toBe(stored);
  });

  it('moves a file between folders and back to the top, recording each move', async () => {
    const h = harness();
    const a = await made(h, 'A');
    const b = await made(h, 'B');
    await h.files.upload(manager, 'c-1', [upload('f.pdf')], a);
    const id = (await h.files.list(manager, 'c-1'))[0]?.id ?? '';

    expect((await h.files.moveFile(manager, id, b)).ok).toBe(true);
    expect((await h.files.list(manager, 'c-1'))[0]?.folderId).toBe(b);
    expect((await h.files.moveFile(manager, id, null)).ok).toBe(true);
    expect((await h.files.list(manager, 'c-1'))[0]?.folderId).toBeNull();
    expect(h.events.filter((e) => e === 'clients.file.moved')).toHaveLength(2);
    expect((await h.files.moveFile(manager, id, 'nowhere')).ok).toBe(false);
  });

  it('renames a folder, but not to a name its neighbour has', async () => {
    const h = harness();
    const a = await made(h, 'A');
    await made(h, 'B');
    expect((await h.files.renameFolder(manager, a, 'Archive')).ok).toBe(true);
    expect((await h.files.folders(manager, 'c-1')).map((f) => f.name)).toContain('Archive');
    const clash = await h.files.renameFolder(manager, a, 'b');
    expect(clash.ok).toBe(false);
  });

  it('removes only an empty folder, and says what to do otherwise', async () => {
    const h = harness();
    const outer = await made(h, 'Outer');
    const inner = await made(h, 'Inner', outer);
    await h.files.upload(manager, 'c-1', [upload('f.pdf')], inner);

    const withSub = await h.files.removeFolder(manager, outer);
    expect(!withSub.ok && withSub.error.message).toContain('Move or remove');
    const withFile = await h.files.removeFolder(manager, inner);
    expect(withFile.ok).toBe(false);

    const id = (await h.files.list(manager, 'c-1'))[0]?.id ?? '';
    await h.files.remove(manager, id);
    expect((await h.files.removeFolder(manager, inner)).ok).toBe(true);
    expect((await h.files.removeFolder(manager, outer)).ok).toBe(true);
    expect(await h.files.folders(manager, 'c-1')).toEqual([]);
  });

  it('gives a stranger no folders and no way to make one', async () => {
    const h = harness();
    await made(h, 'Private');
    expect(await h.files.folders(stranger, 'c-1')).toEqual([]);
    expect((await h.files.createFolder(stranger, 'c-1', 'Mine', null)).ok).toBe(false);
    const folder = (await h.files.folders(manager, 'c-1'))[0]?.id ?? '';
    expect((await h.files.removeFolder(stranger, folder)).ok).toBe(false);
  });

  it('keeps a folder to its own client', async () => {
    const h = harness();
    const folder = await made(h, 'Statements');
    const other = await h.files.upload(manager, 'c-2', [upload('x.pdf')], folder);
    expect(other.ok).toBe(false);
  });
});
