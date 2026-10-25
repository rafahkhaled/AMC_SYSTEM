import type { ClientFileView, ClientFolderView } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DragEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Empty, Field, Loading, Select } from '../../design/index.js';
import {
  clientFileLink,
  clientFiles,
  clientFolders,
  createClientFolder,
  moveClientFile,
  removeClientFile,
  removeClientFolder,
  renameClientFolder,
  uploadClientFiles,
} from './api.js';

/** What the server will hold in one object. A bigger file is refused there anyway. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * The folder every client has (any file, not only the paperwork).
 *
 * Separate from the documents above it on purpose: those are typed and dated
 * and chased for renewal, and a spreadsheet a client emailed is none of that.
 * Dropping files in is the whole interaction — there is no form to fill in
 * first, because the value of a folder is that putting something in is easy.
 */
export function ClientFilesPanel({
  clientId,
  canEdit = true,
}: {
  clientId: string;
  /** Whether this person may make folders, upload, move and remove. */
  canEdit?: boolean;
}) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [refused, setRefused] = useState<{ name: string; reason: string }[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ id: string; failed: boolean } | null>(null);

  const key = ['client-files', clientId];
  const folderKey = ['client-folders', clientId];
  const folder = useQuery({ queryKey: key, queryFn: () => clientFiles(clientId) });
  const folderList = useQuery({ queryKey: folderKey, queryFn: () => clientFolders(clientId) });
  /** The folder being looked at; null is the top of the client's folder. */
  const [current, setCurrent] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const allFolders = folderList.data ?? [];
  const byId = new Map(allFolders.map((one) => [one.id, one]));
  /** From the top down to where we are: what the breadcrumb shows. */
  const trail: ClientFolderView[] = [];
  for (
    let at = current ? byId.get(current) : undefined;
    at;
    at = at.parentId ? byId.get(at.parentId) : undefined
  ) {
    trail.unshift(at);
  }
  // A folder that is gone (removed in another window) sends us back to the top.
  const here = current !== null && !byId.has(current) && folderList.data ? null : current;
  const pathOf = (id: string): string =>
    [
      ...(function* () {
        for (let at = byId.get(id); at; at = at.parentId ? byId.get(at.parentId) : undefined) {
          yield at.name;
        }
      })(),
    ]
      .reverse()
      .join(' / ');

  const changed = () => {
    void queries.invalidateQueries({ queryKey: key });
    void queries.invalidateQueries({ queryKey: folderKey });
  };
  const failed = (error: unknown) => setProblem((error as Error).message);

  const create = useMutation({
    mutationFn: (name: string) => createClientFolder(clientId, name, here),
    onSuccess: (next) => {
      queries.setQueryData(folderKey, next);
      setProblem(null);
    },
    onError: failed,
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameClientFolder(id, name),
    onSuccess: () => {
      setProblem(null);
      changed();
    },
    onError: failed,
  });
  const deleteFolder = useMutation({
    mutationFn: (id: string) => removeClientFolder(id),
    onSuccess: () => {
      setProblem(null);
      changed();
    },
    onError: failed,
  });
  const move = useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) =>
      moveClientFile(id, folderId),
    onSuccess: () => {
      setMoving(null);
      setProblem(null);
      changed();
    },
    onError: failed,
  });

  /*
   * Files are sent ten at a time, which is what the server takes in one go,
   * and a folder chosen from the computer keeps its shape: each sub-folder is
   * made here (or found, if it is already there) and its files go into it.
   */
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const folderFor = await folderMaker(clientId, here, allFolders);
      const groups = new Map<string | null, File[]>();
      for (const file of files) {
        const target = await folderFor(directoriesOf(file));
        groups.set(target, [...(groups.get(target) ?? []), file]);
      }
      let last: Awaited<ReturnType<typeof uploadClientFiles>> = { files: [], refused: [] };
      const refusedAll: { name: string; reason: string }[] = [];
      for (const [target, group] of groups) {
        for (let at = 0; at < group.length; at += 10) {
          last = await uploadClientFiles(clientId, group.slice(at, at + 10), target);
          refusedAll.push(...last.refused);
        }
      }
      return { files: last.files, refused: refusedAll };
    },
    onSuccess: (result) => {
      queries.setQueryData(key, result.files);
      void queries.invalidateQueries({ queryKey: folderKey });
      setRefused(result.refused);
      if (input.current) input.current.value = '';
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeClientFile(id),
    onSuccess: () => {
      setRemoving(null);
      void queries.invalidateQueries({ queryKey: key });
    },
  });

  function take(list: FileList | null) {
    const chosen = Array.from(list ?? []);
    if (chosen.length === 0) return;

    // Too big is said here, before anything is sent: finding out after
    // uploading twenty megabytes is a worse way to learn the limit.
    const tooBig = chosen.filter((file) => file.size > MAX_BYTES);
    const fine = chosen.filter((file) => file.size <= MAX_BYTES);
    setRefused(tooBig.map((file) => ({ name: file.name, reason: t('clientFiles.tooLarge') })));
    if (fine.length > 0) upload.mutate(fine);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    take(event.dataTransfer.files);
  }

  /*
   * The link is fetched when it is wanted rather than sent with the list: one
   * minted for every row would start expiring as the page loaded, and most of
   * them would never be used.
   */
  async function download(file: ClientFileView) {
    setOpened({ id: file.id, failed: false });
    try {
      window.open(await clientFileLink(file.id), '_blank', 'noopener,noreferrer');
      setOpened(null);
    } catch {
      setOpened({ id: file.id, failed: true });
    }
  }

  const files = (folder.data ?? []).filter((file) => (file.folderId ?? null) === here);
  const subfolders = allFolders.filter((one) => (one.parentId ?? null) === here);

  return (
    <Card title={t('clientFiles.title')} description={t('clientFiles.hint')}>
      <div className="u-stack">
        <nav aria-label={t('clientFiles.breadcrumb')} className="u-row u-row--tight u-wrap">
          <Button
            small
            tone={here === null ? 'secondary' : 'quiet'}
            onClick={() => setCurrent(null)}
          >
            {t('clientFiles.allFiles')}
          </Button>
          {trail.map((step) => (
            <span key={step.id} className="u-row u-row--tight">
              <span className="u-text-faint" aria-hidden="true">
                /
              </span>
              <Button
                small
                tone={step.id === here ? 'secondary' : 'quiet'}
                onClick={() => setCurrent(step.id)}
              >
                {step.name}
              </Button>
            </span>
          ))}
        </nav>

        {canEdit ? (
          <NewFolder busy={create.isPending} onCreate={(name) => create.mutate(name)} />
        ) : null}
        {problem ? <Alert tone="error">{problem}</Alert> : null}

        {/*
          A label for the file input rather than a div with a click handler, so
          it is reachable by keyboard and announced as a file control. No
          `accept`: any file is the point.
        */}
        {canEdit ? (
          <label
            htmlFor={inputId}
            className={`dropzone${dragging ? ' dropzone--over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              ref={input}
              id={inputId}
              type="file"
              multiple
              className="u-visually-hidden"
              onChange={(event) => take(event.target.files)}
            />
            <strong>
              {upload.isPending ? t('clientFiles.uploading') : t('clientFiles.dropHere')}
            </strong>
            <span className="u-text-faint">{t('clientFiles.limits')}</span>
          </label>
        ) : null}
        {canEdit ? (
          <div className="u-row">
            <label className="button button--secondary button--small">
              {t('clientFiles.uploadFolder')}
              <input
                type="file"
                multiple
                className="u-visually-hidden"
                // A whole folder from the computer, with what is inside it.
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                onChange={(event) => {
                  take(event.target.files);
                  event.target.value = '';
                }}
              />
            </label>
          </div>
        ) : null}

        {upload.isError ? <Alert tone="error">{(upload.error as Error).message}</Alert> : null}
        {refused.length > 0 ? (
          <Alert tone="warning">
            <strong>{t('clientFiles.notKept')}</strong>
            <ul>
              {refused.map((one) => (
                <li key={one.name} className="u-typed">
                  {one.name}: {one.reason}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {folder.isLoading ? <Loading label={t('loading')} /> : null}
        {folder.isError ? <Alert tone="error">{t('clientFiles.failed')}</Alert> : null}
        {folder.data && files.length === 0 && subfolders.length === 0 ? (
          <Empty title={here === null ? t('clientFiles.none') : t('clientFiles.folderHere')} />
        ) : null}

        {subfolders.length > 0 ? (
          <ul className="u-stack-tight">
            {subfolders.map((one) => (
              <FolderRow
                key={one.id}
                folder={one}
                canEdit={canEdit}
                busy={rename.isPending || deleteFolder.isPending}
                onOpen={() => setCurrent(one.id)}
                onRename={(name) => rename.mutate({ id: one.id, name })}
                onDelete={() => deleteFolder.mutate(one.id)}
              />
            ))}
          </ul>
        ) : null}

        {files.length > 0 ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('clientFiles.columns.name')}</th>
                  <th scope="col" className="table__figure">
                    {t('clientFiles.columns.size')}
                  </th>
                  <th scope="col">{t('clientFiles.columns.added')}</th>
                  <th scope="col">{t('clientFiles.columns.manage')}</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id}>
                    <th scope="row" className="u-typed">
                      {file.name}
                    </th>
                    <td className="table__figure u-numeric">{readableSize(file.sizeBytes)}</td>
                    <td>
                      <span className="u-ltr">{file.uploadedAt.slice(0, 10)}</span>
                      {file.uploadedBy ? (
                        <span className="u-block u-text-faint u-typed">{file.uploadedBy}</span>
                      ) : null}
                    </td>
                    <td>
                      {removing === file.id ? (
                        /*
                         * Asked once, in place. Removing is recoverable by the
                         * firm — the record stays — but not from this screen,
                         * so a mis-click should not be enough.
                         */
                        <div className="u-row u-row--tight">
                          <Button
                            small
                            tone="danger"
                            busy={remove.isPending}
                            onClick={() => remove.mutate(file.id)}
                          >
                            {t('clientFiles.confirmRemove')}
                          </Button>
                          <Button small tone="quiet" onClick={() => setRemoving(null)}>
                            {t('clientFiles.keep')}
                          </Button>
                        </div>
                      ) : (
                        <div className="u-row u-row--tight">
                          <Button
                            small
                            tone="secondary"
                            busy={opened?.id === file.id && !opened.failed}
                            onClick={() => void download(file)}
                          >
                            {t('clientFiles.download')}
                          </Button>
                          {canEdit ? (
                            <>
                              <Button
                                small
                                tone="quiet"
                                onClick={() => setMoving(moving === file.id ? null : file.id)}
                              >
                                {t('clientFiles.move')}
                              </Button>
                              <Button small tone="quiet" onClick={() => setRemoving(file.id)}>
                                {t('clientFiles.remove')}
                              </Button>
                            </>
                          ) : null}
                        </div>
                      )}
                      {moving === file.id ? (
                        <Field
                          label={t('clientFiles.moveTo')}
                          control={(props) => (
                            <Select
                              {...props}
                              value={file.folderId ?? ''}
                              onChange={(event) =>
                                move.mutate({ id: file.id, folderId: event.target.value || null })
                              }
                            >
                              <option value="">{t('clientFiles.topLevel')}</option>
                              {allFolders
                                .map((one) => ({ id: one.id, path: pathOf(one.id) }))
                                .sort((a, b) => a.path.localeCompare(b.path))
                                .map((one) => (
                                  <option key={one.id} value={one.id}>
                                    {one.path}
                                  </option>
                                ))}
                            </Select>
                          )}
                        />
                      ) : null}
                      {opened?.id === file.id && opened.failed ? (
                        <span className="u-block u-danger">{t('clientFiles.openFailed')}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {remove.isError ? <Alert tone="error">{(remove.error as Error).message}</Alert> : null}
      </div>
    </Card>
  );
}

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Makes a folder where we are. Opens in place, so making one is two clicks and a name. */
function NewFolder({ onCreate, busy }: { onCreate: (name: string) => void; busy: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  if (!open) {
    return (
      <div className="u-row">
        <Button small tone="secondary" onClick={() => setOpen(true)}>
          {t('clientFiles.newFolder')}
        </Button>
      </div>
    );
  }
  return (
    <form
      className="u-row u-row-top"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() === '') return;
        onCreate(name.trim());
        setName('');
        setOpen(false);
      }}
    >
      <Field
        label={t('clientFiles.folderName')}
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoFocus
      />
      <Button type="submit" small disabled={name.trim() === ''} busy={busy}>
        {t('clientFiles.createFolder')}
      </Button>
      <Button type="button" small tone="quiet" onClick={() => setOpen(false)}>
        {t('clientFiles.cancel')}
      </Button>
    </form>
  );
}

function FolderRow({
  folder,
  canEdit,
  busy,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: ClientFolderView;
  canEdit: boolean;
  busy: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(folder.name);
  const [confirming, setConfirming] = useState(false);

  if (renaming) {
    return (
      <li>
        <form
          className="u-row u-row-top"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() === '') return;
            onRename(name.trim());
            setRenaming(false);
          }}
        >
          <Field
            label={t('clientFiles.folderName')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          <Button type="submit" small disabled={name.trim() === ''} busy={busy}>
            {t('clientFiles.save')}
          </Button>
          <Button type="button" small tone="quiet" onClick={() => setRenaming(false)}>
            {t('clientFiles.cancel')}
          </Button>
        </form>
      </li>
    );
  }

  return (
    <li className="line">
      <button type="button" className="link-button u-typed" onClick={onOpen}>
        {folder.name}
      </button>
      <span className="u-text-faint">{t('clientFiles.items', { count: folder.fileCount })}</span>
      <span className="u-grow" />
      {canEdit ? (
        confirming ? (
          <>
            <Button small tone="danger" busy={busy} onClick={onDelete}>
              {t('clientFiles.removeFolder')}
            </Button>
            <Button small tone="quiet" onClick={() => setConfirming(false)}>
              {t('clientFiles.keep')}
            </Button>
          </>
        ) : (
          <>
            <Button small tone="quiet" onClick={() => setRenaming(true)}>
              {t('clientFiles.rename')}
            </Button>
            <Button small tone="quiet" onClick={() => setConfirming(true)}>
              {t('clientFiles.remove')}
            </Button>
          </>
        )
      ) : null}
    </li>
  );
}

/** The folders a file sat in on the computer, from a folder upload. Empty for a loose file. */
function directoriesOf(file: File): string[] {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
  const parts = path.split('/').filter((part) => part !== '');
  return parts.slice(0, -1);
}

/**
 * Finds or makes the folder for a path of names under where the person is.
 * Remembers what it has made, so a folder of two hundred files makes each
 * sub-folder once.
 */
async function folderMaker(
  clientId: string,
  under: string | null,
  known: readonly ClientFolderView[],
): Promise<(path: string[]) => Promise<string | null>> {
  let folders = [...known];
  const made = new Map<string, string>();

  return async (path) => {
    let parent = under;
    for (let depth = 0; depth < path.length; depth += 1) {
      const name = path[depth] as string;
      const key = `${parent ?? ''}/${name.toLowerCase()}`;
      const found =
        made.get(key) ??
        folders.find(
          (folder) =>
            (folder.parentId ?? null) === parent &&
            folder.name.toLowerCase() === name.toLowerCase(),
        )?.id;
      if (found) {
        made.set(key, found);
        parent = found;
        continue;
      }
      folders = await createClientFolder(clientId, name, parent);
      const created = folders.find(
        (folder) =>
          (folder.parentId ?? null) === parent && folder.name.toLowerCase() === name.toLowerCase(),
      );
      if (!created) throw new Error(name);
      made.set(key, created.id);
      parent = created.id;
    }
    return parent;
  };
}
