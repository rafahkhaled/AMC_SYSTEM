import type { DocumentSummary } from '@amc/contracts';
import { type DragEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Field, Select } from '../../design/index.js';
import { useOptions } from '../lists/use-options.js';
import { uploadDocument } from './api.js';
import { EXPIRES, fieldsFor, guessType } from './document-fields.js';

/** What the server will keep. Anything else is a mistake or an attempt. */
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.tif,.tiff';

/** One file waiting to be filed, with what is known about it so far. */
interface Pending {
  readonly key: string;
  readonly file: File;
  type: string;
  authority: string;
  number: string;
  /** The description for "other", and the address for a tenancy contract. */
  label: string;
  issuedOn: string;
  expiresOn: string;
  error: string | null;
}

/**
 * Filing a client's documents: one, or several at once.
 *
 * Several files can be chosen or dropped together. Each gets its own row, with
 * the fields its type asks for, and they are uploaded together. One refused
 * (a licence without its expiry date) stays on the list with the reason, and
 * the others go through, so nobody has to start again.
 */
export function DocumentUpload({
  clientId,
  onUploaded,
}: {
  clientId: string;
  onUploaded: (documents: DocumentSummary[]) => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const documentTypes = useOptions('document_type');
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const codes = documentTypes.live.map((option) => option.code);

  function take(chosen: FileList | null) {
    const files = Array.from(chosen ?? []);
    if (files.length === 0) return;
    const fallback = codes[0] ?? 'other';
    setPending((now) => [
      ...now,
      ...files.map((file, index) => ({
        key: `${Date.now()}-${index}-${file.name}`,
        file,
        type: guessType(file.name, codes) ?? fallback,
        authority: '',
        number: '',
        label: '',
        issuedOn: '',
        expiresOn: '',
        error: null,
      })),
    ]);
    if (input.current) input.current.value = '';
  }

  const change = (key: string, patch: Partial<Pending>) =>
    setPending((now) =>
      now.map((row) => (row.key === key ? { ...row, ...patch, error: null } : row)),
    );
  const drop = (key: string) => setPending((now) => now.filter((row) => row.key !== key));

  const missingExpiry = (row: Pending) => EXPIRES.has(row.type) && row.expiresOn === '';
  const ready = pending.length > 0 && !pending.some(missingExpiry);

  async function uploadAll() {
    setBusy(true);
    let latest: DocumentSummary[] | null = null;
    const left: Pending[] = [];
    for (const row of pending) {
      const fields = fieldsFor(row.type);
      try {
        const result = await uploadDocument(clientId, row.file, {
          type: row.type,
          ...(fields.authority && row.authority ? { authority: row.authority } : {}),
          ...(row.label.trim() ? { label: row.label.trim() } : {}),
          ...(fields.number && row.number.trim() ? { referenceNumber: row.number.trim() } : {}),
          ...(row.issuedOn ? { issuedOn: row.issuedOn } : {}),
          ...(row.expiresOn ? { expiresOn: row.expiresOn } : {}),
        });
        latest = result.documents;
      } catch (failure) {
        left.push({ ...row, error: failure instanceof Error ? failure.message : String(failure) });
      }
    }
    setPending(left);
    setBusy(false);
    if (latest) onUploaded(latest);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    take(event.dataTransfer.files);
  }

  return (
    <form
      className="u-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) void uploadAll();
      }}
    >
      {/*
        A label for the file input rather than a div with a click handler, so
        it is reachable by keyboard and announced as a file control.
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
          accept={ACCEPT}
          className="u-visually-hidden"
          onChange={(event) => take(event.target.files)}
        />
        <strong>{t('documents.dropHere')}</strong>
        <span className="u-text-faint">{t('documents.accepted')}</span>
      </label>

      {pending.map((row) => (
        <PendingRow
          key={row.key}
          row={row}
          onChange={(patch) => change(row.key, patch)}
          onRemove={() => drop(row.key)}
          disabled={busy}
        />
      ))}

      {pending.length > 0 ? (
        <div className="u-row">
          <Button type="submit" disabled={!ready} busy={busy}>
            {pending.length > 1
              ? t('documents.uploadMany', { count: pending.length })
              : t('documents.upload')}
          </Button>
          <Button type="button" tone="quiet" disabled={busy} onClick={() => setPending([])}>
            {t('documents.clear')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function PendingRow({
  row,
  onChange,
  onRemove,
  disabled,
}: {
  row: Pending;
  onChange: (patch: Partial<Pending>) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const documentTypes = useOptions('document_type');
  const authorities = useOptions('authority');
  const fields = fieldsFor(row.type);
  const needsExpiry = EXPIRES.has(row.type);

  return (
    <fieldset className="u-stack-tight pending-document" disabled={disabled}>
      <legend className="u-row u-row--tight">
        <strong className="u-ltr">{row.file.name}</strong>
        <span className="u-text-faint">{readableSize(row.file.size)}</span>
        <Button type="button" small tone="quiet" onClick={onRemove}>
          {t('documents.removeFile')}
        </Button>
      </legend>

      <Field
        label={t('documents.type')}
        control={(props) => (
          <Select
            {...props}
            value={row.type}
            onChange={(event) => onChange({ type: event.target.value })}
          >
            {documentTypes.live.map((option) => (
              <option key={option.code} value={option.code}>
                {documentTypes.label(option.code)}
              </option>
            ))}
          </Select>
        )}
      />

      {fields.number ? (
        <Field
          label={t(fields.number)}
          ltr
          value={row.number}
          onChange={(event) => onChange({ number: event.target.value })}
        />
      ) : null}

      {fields.authority ? (
        <Field
          label={t('documents.authority')}
          hint={t('documents.authorityHint')}
          control={(props) => (
            <Select
              {...props}
              value={row.authority}
              onChange={(event) => onChange({ authority: event.target.value })}
            >
              <option value="">{t('documents.authorityUnknown')}</option>
              {authorities.live.map((option) => (
                <option key={option.code} value={option.code}>
                  {authorities.label(option.code)}
                </option>
              ))}
            </Select>
          )}
        />
      ) : null}

      {fields.address ? (
        <Field
          label={t('documents.address')}
          value={row.label}
          onChange={(event) => onChange({ label: event.target.value })}
        />
      ) : null}

      {row.type === 'other' ? (
        <Field
          label={t('documents.label')}
          hint={t('documents.labelHint')}
          value={row.label}
          onChange={(event) => onChange({ label: event.target.value })}
        />
      ) : null}

      <div className="u-row u-row-top">
        <Field
          label={t('documents.issuedOn')}
          type="date"
          value={row.issuedOn}
          onChange={(event) => onChange({ issuedOn: event.target.value })}
        />
        <Field
          label={needsExpiry ? t('documents.expiresOnRequired') : t('documents.expiresOn')}
          {...(needsExpiry ? { hint: t('documents.expiryChases') } : {})}
          {...(needsExpiry && row.expiresOn === '' ? { error: t('documents.expiryNeeded') } : {})}
          type="date"
          required={needsExpiry}
          value={row.expiresOn}
          onChange={(event) => onChange({ expiresOn: event.target.value })}
        />
      </div>

      {row.error ? <Alert tone="error">{row.error}</Alert> : null}
    </fieldset>
  );
}

/** Kilobytes and megabytes, because nobody reads a file size in bytes. */
function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
