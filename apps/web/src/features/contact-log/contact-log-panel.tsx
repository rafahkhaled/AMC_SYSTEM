import type { ContactLogEntryView } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Empty, Field, Loading } from '../../design/index.js';
import { attachmentLink, contactLog, recordContact } from './api.js';

const CHANNELS = ['call', 'whatsapp', 'email', 'meeting', 'portal', 'other'] as const;

/** Screenshots, which is what makes "we asked three times" provable. */
const ACCEPT = '.png,.jpg,.jpeg,.webp,.heic,.pdf';

/**
 * What was said to this client, most recent first (FR-06).
 *
 * The time a conversation happened is asked for separately from the time it
 * is typed up, because a call on Tuesday written up on Thursday is a call on
 * Tuesday — and the chase counts days from the former.
 */
export function ContactLogPanel({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const key = ['contact-log', clientId];
  const log = useQuery({ queryKey: key, queryFn: () => contactLog(clientId) });

  return (
    <Card title={t('contactLog.title')} description={t('contactLog.hint')}>
      {log.isLoading ? <Loading label={t('loading')} /> : null}
      {log.isError ? <p className="alert alert--error">{t('contactLog.failed')}</p> : null}

      {log.data && log.data.length === 0 ? (
        <Empty title={t('contactLog.none')} description={t('contactLog.noneHint')} />
      ) : null}

      {log.data && log.data.length > 0 ? (
        <div className="u-stack-tight">
          {log.data.map((entry) => (
            <EntryRow key={entry.id} clientId={clientId} entry={entry} />
          ))}
        </div>
      ) : null}

      <RecordContact
        clientId={clientId}
        onRecorded={(entries) => queries.setQueryData(key, entries)}
      />
    </Card>
  );
}

function EntryRow({ clientId, entry }: { clientId: string; entry: ContactLogEntryView }) {
  const { t, i18n } = useTranslation();

  const when = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-AE' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    // Dubai, always. The person reading this works there, whatever the
    // machine serving the page thinks the time is.
    timeZone: 'Asia/Dubai',
  }).format(new Date(entry.happenedAt));

  return (
    <div className="u-stack-tight contact-entry">
      <div className="line">
        <Badge tone={entry.direction === 'inbound' ? 'accent' : 'neutral'}>
          {t(`contactLog.channels.${entry.channel}`)}
        </Badge>
        <span className="u-text-faint">{t(`contactLog.directions.${entry.direction}`)}</span>
        <span className="u-grow" />
        <span className="u-text-faint">{when}</span>
      </div>
      <p className="contact-entry__summary">{entry.summary}</p>
      {entry.attachments.length > 0 ? (
        <div className="u-row">
          {entry.attachments.map((file) => (
            <Attachment key={file.id} clientId={clientId} id={file.id} name={file.name} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Attachment({
  clientId,
  id,
  name,
}: {
  clientId: string;
  id: string;
  name: string;
}) {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);

  /*
   * The link is minted when it is wanted. One per screenshot on page load
   * would start expiring immediately, and most would never be used.
   */
  async function open() {
    setOpening(true);
    try {
      const url = await attachmentLink(clientId, id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setOpening(false);
    }
  }

  return (
    <Button small tone="quiet" busy={opening} onClick={() => void open()}>
      {name || t('contactLog.attachment')}
    </Button>
  );
}

function RecordContact({
  clientId,
  onRecorded,
}: {
  clientId: string;
  onRecorded: (entries: ContactLogEntryView[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState('call');
  const [direction, setDirection] = useState('outbound');
  const [happenedAt, setHappenedAt] = useState('');
  const [summary, setSummary] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  const record = useMutation({
    mutationFn: () =>
      recordContact(clientId, { channel, direction, happenedAt, summary: summary.trim() }, files),
    onSuccess: (entries) => {
      onRecorded(entries);
      setOpen(false);
      setHappenedAt('');
      setSummary('');
      setFiles([]);
    },
  });

  if (!open) {
    return (
      <Button small tone="secondary" onClick={() => setOpen(true)}>
        {t('contactLog.add')}
      </Button>
    );
  }

  const ready = happenedAt !== '' && summary.trim().length >= 3;

  return (
    <form
      className="u-stack contact-entry__form"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) record.mutate();
      }}
    >
      <div className="u-row u-row-top">
        <Field
          label={t('contactLog.channel')}
          control={(props) => (
            <select
              {...props}
              className="input"
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
            >
              {CHANNELS.map((code) => (
                <option key={code} value={code}>
                  {t(`contactLog.channels.${code}`)}
                </option>
              ))}
            </select>
          )}
        />
        <Field
          label={t('contactLog.direction')}
          control={(props) => (
            <select
              {...props}
              className="input"
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
            >
              <option value="outbound">{t('contactLog.directions.outbound')}</option>
              <option value="inbound">{t('contactLog.directions.inbound')}</option>
            </select>
          )}
        />
        <Field
          label={t('contactLog.when')}
          hint={t('contactLog.whenHint')}
          type="datetime-local"
          value={happenedAt}
          onChange={(event) => setHappenedAt(event.target.value)}
        />
      </div>

      <Field
        label={t('contactLog.summary')}
        hint={t('contactLog.summaryHint')}
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
      />

      <Field
        label={t('contactLog.screenshots')}
        hint={t('contactLog.screenshotsHint')}
        type="file"
        accept={ACCEPT}
        multiple
        onChange={(event) => setFiles([...(event.target.files ?? [])])}
      />

      {record.error ? <Alert tone="error">{record.error.message}</Alert> : null}

      <div className="u-row">
        <Button type="submit" disabled={!ready} busy={record.isPending}>
          {t('contactLog.save')}
        </Button>
        <Button type="button" tone="quiet" onClick={() => setOpen(false)}>
          {t('documents.clear')}
        </Button>
      </div>
    </form>
  );
}
