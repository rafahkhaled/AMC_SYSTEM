import type { ClientFileView } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DragEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Empty, Loading } from '../../design/index.js';
import { clientFileLink, clientFiles, removeClientFile, uploadClientFiles } from './api.js';

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
export function ClientFilesPanel({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [refused, setRefused] = useState<{ name: string; reason: string }[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ id: string; failed: boolean } | null>(null);

  const key = ['client-files', clientId];
  const folder = useQuery({ queryKey: key, queryFn: () => clientFiles(clientId) });

  const upload = useMutation({
    mutationFn: (files: File[]) => uploadClientFiles(clientId, files),
    onSuccess: (result) => {
      queries.setQueryData(key, result.files);
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

  const files = folder.data ?? [];

  return (
    <Card title={t('clientFiles.title')} description={t('clientFiles.hint')}>
      <div className="u-stack">
        {/*
          A label for the file input rather than a div with a click handler, so
          it is reachable by keyboard and announced as a file control. No
          `accept`: any file is the point.
        */}
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
        {folder.data && files.length === 0 ? <Empty title={t('clientFiles.none')} /> : null}

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
                          <Button small tone="quiet" onClick={() => setRemoving(file.id)}>
                            {t('clientFiles.remove')}
                          </Button>
                        </div>
                      )}
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
