import type { TimerState } from '@amc/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Field, Select } from '../../design/index.js';
import { recordManual } from './api.js';

interface Option {
  readonly projectId: string;
  readonly label: string;
}

/**
 * Time that was worked but not timed (FR-22).
 *
 * The reason is required here, in the domain and in the database. Time typed
 * in afterwards is the part of a client statement most likely to be
 * questioned, and an entry that cannot say why it exists is one the firm has
 * to defend without evidence.
 */
export function ManualEntry({
  projects,
  onRecorded,
}: {
  projects: readonly Option[];
  onRecorded: (state: TimerState) => void;
}) {
  const { t } = useTranslation();
  const [projectId, setProjectId] = useState('');
  const [startedAt, setStartedAt] = useState('');
  const [endedAt, setEndedAt] = useState('');
  const [reason, setReason] = useState('');
  const [billable, setBillable] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  /** Set when Record was pressed, so what is missing is marked rather than the button greyed out. */
  const [tried, setTried] = useState(false);

  const record = useMutation({
    mutationFn: () =>
      recordManual({ projectId, startedAt, endedAt, reason: reason.trim(), billable }),
    onSuccess: (state) => {
      onRecorded(state);
      // The entry may be for a past day, so today's list will not show it. The
      // confirmation is built from what was submitted rather than from the
      // response, because otherwise a correct write looks like nothing at all.
      setDone(
        t('timer.recorded', { length: spanOf(startedAt, endedAt), day: startedAt.slice(0, 10) }),
      );
      setStartedAt('');
      setEndedAt('');
      setReason('');
    },
  });

  const ready =
    projectId !== '' &&
    startedAt !== '' &&
    endedAt !== '' &&
    reason.trim().length >= 3 &&
    endedAt > startedAt;

  return (
    <Card title={t('timer.addByHand')} description={t('timer.addByHandHint')}>
      <form
        className="u-stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setDone(null);
          setTried(true);
          if (ready) record.mutate();
        }}
      >
        <Field
          label={t('timer.whichProject')}
          control={(props) => (
            <Select
              {...props}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className={tried && projectId === '' ? 'input--invalid' : undefined}
            >
              <option value="">{t('timer.chooseProject')}</option>
              {projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.label}
                </option>
              ))}
            </Select>
          )}
        />

        <div className="u-row u-row-top">
          <Field
            label={t('timer.from')}
            type="datetime-local"
            required
            value={startedAt}
            onChange={(event) => setStartedAt(event.target.value)}
            {...(tried && startedAt === '' ? { error: t('form.required') } : {})}
          />
          <Field
            label={t('timer.to')}
            type="datetime-local"
            required
            value={endedAt}
            onChange={(event) => setEndedAt(event.target.value)}
            {...(tried && endedAt === ''
              ? { error: t('form.required') }
              : tried && startedAt !== '' && endedAt <= startedAt
                ? { error: t('timer.endBeforeStart') }
                : {})}
          />
        </div>

        <Field
          label={t('timer.reason')}
          hint={t('timer.reasonHint')}
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          {...(tried && reason.trim().length < 3 ? { error: t('timer.reasonTooShort') } : {})}
        />

        <label className="u-row checkbox">
          <input
            type="checkbox"
            checked={billable}
            onChange={(event) => setBillable(event.target.checked)}
          />
          <span>
            {t('timer.billable')}
            <span className="u-block u-text-faint">{t('timer.billableHint')}</span>
          </span>
        </label>

        {record.error ? <Alert tone="error">{record.error.message}</Alert> : null}
        {done ? <Alert tone="success">{done}</Alert> : null}

        <div className="u-row">
          <Button type="submit" busy={record.isPending}>
            {t('timer.record')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** How long the two wall-clock times are apart, as 2:30. */
function spanOf(from: string, to: string): string {
  const seconds = Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 1000);
  const hours = Math.floor(seconds / 3600);
  return `${hours}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}`;
}
