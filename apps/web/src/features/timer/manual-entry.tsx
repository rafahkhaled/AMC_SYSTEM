import type { TimerState } from '@amc/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Field } from '../../design/index.js';
import { recordManual } from './api.js';

interface Option {
  readonly taskId: string;
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
  tasks,
  onRecorded,
}: {
  tasks: readonly Option[];
  onRecorded: (state: TimerState) => void;
}) {
  const { t } = useTranslation();
  const [taskId, setTaskId] = useState('');
  const [startedAt, setStartedAt] = useState('');
  const [endedAt, setEndedAt] = useState('');
  const [reason, setReason] = useState('');
  const [billable, setBillable] = useState(true);
  const [done, setDone] = useState<string | null>(null);

  const record = useMutation({
    mutationFn: () => recordManual({ taskId, startedAt, endedAt, reason: reason.trim(), billable }),
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
    taskId !== '' &&
    startedAt !== '' &&
    endedAt !== '' &&
    reason.trim().length >= 3 &&
    endedAt > startedAt;

  return (
    <Card title={t('timer.addByHand')} description={t('timer.addByHandHint')}>
      <form
        className="u-stack"
        onSubmit={(event) => {
          event.preventDefault();
          setDone(null);
          if (ready) record.mutate();
        }}
      >
        <Field
          label={t('timer.whichTask')}
          control={(props) => (
            <select
              {...props}
              className="input"
              value={taskId}
              onChange={(event) => setTaskId(event.target.value)}
            >
              <option value="">{t('timer.chooseTask')}</option>
              {tasks.map((task) => (
                <option key={task.taskId} value={task.taskId}>
                  {task.label}
                </option>
              ))}
            </select>
          )}
        />

        <div className="u-row u-row-top">
          <Field
            label={t('timer.from')}
            type="datetime-local"
            value={startedAt}
            onChange={(event) => setStartedAt(event.target.value)}
          />
          <Field
            label={t('timer.to')}
            type="datetime-local"
            value={endedAt}
            onChange={(event) => setEndedAt(event.target.value)}
          />
        </div>

        <Field
          label={t('timer.reason')}
          hint={t('timer.reasonHint')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />

        <label className="u-row checkbox">
          <input
            type="checkbox"
            checked={billable}
            onChange={(event) => setBillable(event.target.checked)}
          />
          <span>{t('timer.billable')}</span>
        </label>

        {record.error ? <Alert tone="error">{record.error.message}</Alert> : null}
        {done ? <Alert tone="success">{done}</Alert> : null}

        <div className="u-row">
          <Button type="submit" disabled={!ready} busy={record.isPending}>
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
