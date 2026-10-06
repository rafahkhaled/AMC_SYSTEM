import type { DocumentSummary } from '@amc/contracts';
import { useMutation } from '@tanstack/react-query';
import { type DragEvent, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Field, Select } from '../../design/index.js';
import { useOptions } from '../lists/use-options.js';
import { uploadDocument } from './api.js';

/**
 * Which document types carry an expiry date.
 *
 * The server refuses one of these without a date, because accepting it would
 * quietly remove the client from every renewal reminder. The form asks for it
 * as a required field rather than letting someone find out by being refused.
 */
const EXPIRES = new Set(['trade_licence', 'emirates_id', 'passport', 'visa', 'tenancy_contract']);

/** What the server will keep. Anything else is a mistake or an attempt. */
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.tif,.tiff';

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
  const authorities = useOptions('authority');
  const [file, setFile] = useState<File | null>(null);
  /*
   * Empty until the list arrives, then the first option.
   *
   * Defaulting to a hardcoded code would quietly reintroduce the thing this
   * change removes: an administrator who retires `trade_licence` would find
   * the form still selecting it.
   */
  const [type, setType] = useState<string>('');
  const [authority, setAuthority] = useState<string>('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');

  // The list decides the default, so retiring an option retires it everywhere.
  const firstType = documentTypes.live[0]?.code;
  useEffect(() => {
    if (type === '' && firstType) setType(firstType);
  }, [type, firstType]);
  const [label, setLabel] = useState('');
  const [dragging, setDragging] = useState(false);

  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new Error(t('documents.chooseFirst'));
      return uploadDocument(clientId, file, {
        type,
        ...(authority ? { authority } : {}),
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(issuedOn ? { issuedOn } : {}),
        ...(expiresOn ? { expiresOn } : {}),
      });
    },
    onSuccess: (result) => {
      onUploaded(result.documents);
      setFile(null);
      setAuthority('');
      setIssuedOn('');
      setExpiresOn('');
      setLabel('');
      if (input.current) input.current.value = '';
    },
  });

  const needsExpiry = EXPIRES.has(type);
  const ready = file !== null && (!needsExpiry || expiresOn !== '');

  function take(dropped: FileList | null) {
    const first = dropped?.[0];
    if (first) setFile(first);
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
        if (ready) upload.mutate();
      }}
    >
      {/*
        The drop area is a label for the file input rather than a div with a
        click handler. That way it is reachable by keyboard and announced as a
        file control, and the drop is an addition to it rather than the only
        way in.
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
          accept={ACCEPT}
          className="u-visually-hidden"
          onChange={(event) => take(event.target.files)}
        />
        <strong>{file ? file.name : t('documents.dropHere')}</strong>
        <span className="u-text-faint">
          {file ? readableSize(file.size) : t('documents.accepted')}
        </span>
      </label>

      <Field
        label={t('documents.type')}
        control={(props) => (
          <Select {...props} value={type} onChange={(event) => setType(event.target.value)}>
            {/* From the list an administrator maintains, not from a constant
                in this file: a practice learns a new document type when a
                client walks in holding one. */}
            {documentTypes.live.map((option) => (
              <option key={option.code} value={option.code}>
                {documentTypes.label(option.code)}
              </option>
            ))}
          </Select>
        )}
      />

      {/* Who issued it. A trade licence from the DED and one from a free zone
          are the same type and not the same document, and which it is decides
          who a renewal is chased with. */}
      <Field
        label={t('documents.authority')}
        hint={t('documents.authorityHint')}
        control={(props) => (
          <Select
            {...props}
            value={authority}
            onChange={(event) => setAuthority(event.target.value)}
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

      {type === 'other' ? (
        <Field
          label={t('documents.label')}
          hint={t('documents.labelHint')}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      ) : null}

      <div className="u-row u-row-top">
        <Field
          label={t('documents.issuedOn')}
          type="date"
          value={issuedOn}
          onChange={(event) => setIssuedOn(event.target.value)}
        />
        <Field
          label={needsExpiry ? t('documents.expiresOnRequired') : t('documents.expiresOn')}
          {...(needsExpiry ? { hint: t('documents.expiryChases') } : {})}
          type="date"
          required={needsExpiry}
          value={expiresOn}
          onChange={(event) => setExpiresOn(event.target.value)}
        />
      </div>

      {upload.error ? <Alert tone="error">{upload.error.message}</Alert> : null}

      <div className="u-row">
        <Button type="submit" disabled={!ready} busy={upload.isPending}>
          {t('documents.upload')}
        </Button>
        {file ? (
          <Button
            type="button"
            tone="quiet"
            onClick={() => {
              setFile(null);
              if (input.current) input.current.value = '';
            }}
          >
            {t('documents.clear')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Kilobytes and megabytes, because nobody reads a file size in bytes. */
function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
