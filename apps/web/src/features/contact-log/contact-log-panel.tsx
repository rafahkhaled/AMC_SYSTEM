import type { ContactLogEntryView } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Empty, Field, Loading, Select } from '../../design/index.js';
import { useDraft } from '../../lib/use-draft.js';
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

  /*
   * Folded away until asked for: a client called every week has a long log,
   * and it pushed everything below it off the page.
   */
  const [shown, setShown] = useState(false);
  const count = log.data?.length ?? 0;

  return (
    <Card title={t('contactLog.title')} description={t('contactLog.hint')}>
      <div className="u-row">
        <Button small tone="secondary" onClick={() => setShown(!shown)} aria-expanded={shown}>
          {shown ? t('contactLog.hide') : t('contactLog.show', { count })}
        </Button>
      </div>
      {shown ? (
        <>
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
        </>
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
      <p className="contact-entry__summary u-typed">{entry.summary}</p>
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
  // Now, by default: most conversations are logged straight after them.
  const [day, setDay] = useState(today());
  const [time, setTime] = useState(nowClock());
  const happenedAt = toLocalStamp(day, time);
  const [summary, setSummary] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  // What was typed, kept until it is recorded; the screenshots cannot be kept.
  const draft = useDraft(
    `contact-log.${clientId}`,
    { channel, direction, day, time, summary },
    (saved) => {
      if (saved.channel !== undefined) setChannel(saved.channel);
      if (saved.direction !== undefined) setDirection(saved.direction);
      if (saved.day !== undefined) setDay(saved.day);
      if (saved.time !== undefined) setTime(saved.time);
      if (saved.summary !== undefined) setSummary(saved.summary);
      setOpen(true);
    },
  );

  const record = useMutation({
    mutationFn: () =>
      recordContact(
        clientId,
        { channel, direction, happenedAt: happenedAt ?? '', summary: summary.trim() },
        files,
      ),
    onSuccess: (entries) => {
      onRecorded(entries);
      draft.discard();
      setOpen(false);
      setDay(today());
      setTime(nowClock());
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

  const ready = happenedAt !== null;

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
            <Select {...props} value={channel} onChange={(event) => setChannel(event.target.value)}>
              {CHANNELS.map((code) => (
                <option key={code} value={code}>
                  {t(`contactLog.channels.${code}`)}
                </option>
              ))}
            </Select>
          )}
        />
        <Field
          label={t('contactLog.direction')}
          control={(props) => (
            <Select
              {...props}
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
            >
              <option value="outbound">{t('contactLog.directions.outbound')}</option>
              <option value="inbound">{t('contactLog.directions.inbound')}</option>
            </Select>
          )}
        />
        <Field
          label={t('contactLog.when')}
          hint={t('contactLog.whenHint')}
          type="date"
          value={day}
          onChange={(event) => setDay(event.target.value)}
        />
        <Field
          label={t('contactLog.time')}
          hint={t('contactLog.timeHint')}
          ltr
          value={time}
          onChange={(event) => setTime(event.target.value)}
          {...(time.trim() !== '' && clockOf(time) === null
            ? { error: t('contactLog.timeUnreadable') }
            : {})}
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
        <Button type="submit" disabled={!ready || record.isPending} busy={record.isPending}>
          {t('contactLog.save')}
        </Button>
        <Button type="button" tone="quiet" onClick={() => setOpen(false)}>
          {t('documents.clear')}
        </Button>
      </div>
    </form>
  );
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function nowClock(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * "14:10", "2:10 pm", "2.10PM", "2:10 م" — the time as people type it, as
 * "HH:MM". The browser's own time box would not take AM or PM typed as letters.
 */
export function clockOf(typed: string): string | null {
  const match = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|ص|م)?\s*$/i.exec(typed);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');
  const half = (match[3] ?? '').toLowerCase();
  if (minutes > 59) return null;
  if (half) {
    if (hours < 1 || hours > 12) return null;
    const afternoon = half.startsWith('p') || half === 'م';
    hours = (hours % 12) + (afternoon ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** The day and time as the "2026-10-10T14:10" the server reads, or null. */
function toLocalStamp(day: string, time: string): string | null {
  const clock = clockOf(time);
  if (!day || !clock) return null;
  return `${day}T${clock}`;
}
