import type { TimeEntryView, TimerState } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Empty, Loading } from '../../design/index.js';
import { clockFace, duration, hoursAndMinutes } from '../../lib/duration.js';
import { taskBoard } from '../tasks/api.js';
import {
  PendingSync,
  beat,
  holdTimer,
  pendingCount,
  replayPending,
  resumeTimer,
  startTimer,
  stopTimer,
  timerState,
} from './api.js';
import { ManualEntry } from './manual-entry.js';
import { TimesheetPanel } from './timesheet.js';

export function TimerPage() {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const state = useQuery({ queryKey: ['timer'], queryFn: timerState });
  /*
   * The open work, so time can be booked against a task without going to find
   * it first. The board is already fetched elsewhere and shares its cache, so
   * this usually costs nothing.
   */
  const board = useQuery({ queryKey: ['tasks'], queryFn: taskBoard });

  const settle = (next: TimerState) => queries.setQueryData(['timer'], next);
  const stop = useMutation({ mutationFn: stopTimer, onSuccess: settle });
  const hold = useMutation({ mutationFn: holdTimer, onSuccess: settle });
  const resume = useMutation({ mutationFn: resumeTimer, onSuccess: settle });

  const waiting = useSync(queries);

  if (state.isLoading) return <Loading label={t('loading')} />;
  if (state.isError) return <p className="alert alert--error">{t('timer.failed')}</p>;

  const data = state.data as TimerState;
  const held = [stop.error, hold.error, resume.error].find(
    (failure) => failure instanceof PendingSync,
  );

  return (
    <div className="u-stack">
      {/*
        An action kept on the device is not a failure, and must not read like
        one. The hour is written down; only the server has not heard yet.
      */}
      {held || waiting > 0 ? (
        <Alert tone="warning">{t('timer.waitingToSync', { count: Math.max(waiting, 1) })}</Alert>
      ) : null}

      <RunningPanel
        state={data}
        onStop={() => stop.mutate()}
        onHold={() => hold.mutate()}
        onResume={() => resume.mutate()}
        busy={stop.isPending || hold.isPending || resume.isPending}
      />

      <Card title={t('timer.today')} description={t('timer.todayHint')}>
        {data.today.length === 0 ? (
          <Empty title={t('timer.nothingToday')} description={t('timer.nothingTodayHint')} />
        ) : (
          <>
            <div className="u-stack-tight">
              {data.today.map((entry) => (
                <EntryRow key={entry.id} entry={entry} />
              ))}
            </div>
            <div className="line totals">
              <strong>{t('timer.total')}</strong>
              <span className="u-grow" />
              <span className="u-text-soft">
                {t('timer.billableOf', {
                  billable: duration(data.todayBillableSeconds, t),
                })}
              </span>
              <strong className="u-ltr u-numeric">{duration(data.todaySeconds, t)}</strong>
            </div>
          </>
        )}
      </Card>

      <ManualEntry
        tasks={(board.data?.columns ?? []).flatMap((column) =>
          column.tasks.map((task) => ({
            taskId: task.id,
            label: `${task.clientName} — ${t(`services.${task.service}`)}`,
          })),
        )}
        onRecorded={(next) => {
          queries.setQueryData(['timer'], next);
          // The entry may belong to a past day, so the week has to be refetched
          // rather than patched from a response that only describes today.
          void queries.invalidateQueries({ queryKey: ['timesheet'] });
        }}
      />

      <TimesheetPanel />
    </div>
  );
}

/**
 * Sends whatever the device is still holding, when it can.
 *
 * On mount, because a tab reopened after a flight is the common case, and on
 * `online`, because that is the browser saying the connection is back. The
 * count is what lets the screen admit there is something outstanding rather
 * than quietly looking correct.
 */
function useSync(queries: ReturnType<typeof useQueryClient>): number {
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function drain() {
      const outcome = await replayPending().catch(() => null);
      if (cancelled) return;
      if (outcome && outcome.sent > 0) {
        void queries.invalidateQueries({ queryKey: ['timer'] });
        void queries.invalidateQueries({ queryKey: ['timesheet'] });
      }
      setWaiting(await pendingCount().catch(() => 0));
    }

    void drain();
    window.addEventListener('online', drain);
    return () => {
      cancelled = true;
      window.removeEventListener('online', drain);
    };
  }, [queries]);

  return waiting;
}

function RunningPanel({
  state,
  onStop,
  onHold,
  onResume,
  busy,
}: {
  state: TimerState;
  onStop: () => void;
  onHold: () => void;
  onResume: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(state.running?.elapsedSeconds ?? 0);

  /*
   * The clock ticks locally but starts from the server's count, and every
   * heartbeat resets it to the server's answer. A tab left open overnight
   * shows what the server thinks rather than whatever its own timer drifted
   * to, and the heartbeat is what separates working from a browser somebody
   * forgot to close.
   */
  const held = state.running?.held ?? false;

  useEffect(() => {
    if (!state.running) return;
    setElapsed(state.running.elapsedSeconds);
    // A held timer counts nothing, so there is nothing to tick and no reason
    // to tell the server a paused tab is still awake.
    if (held) return;

    const tick = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    const pulse = setInterval(() => void beat(), 60_000);
    return () => {
      clearInterval(tick);
      clearInterval(pulse);
    };
  }, [state.running, held]);

  if (!state.running) {
    return (
      <Card title={t('timer.title')}>
        <Empty title={t('timer.notRunning')} description={t('timer.startHint')} />
      </Card>
    );
  }

  return (
    <Card title={t('timer.title')}>
      <div className="running">
        <div className="u-stack-tight">
          <strong>{state.running.clientName}</strong>
          <span className="u-text-soft">{t(`services.${state.running.service}`)}</span>
          {held ? <Badge tone="warning">{t('timer.held')}</Badge> : null}
        </div>
        <span className="u-grow" />
        <div className="u-stack-tight running__reading">
          <span className={`running__clock u-ltr u-numeric${held ? ' running__clock--held' : ''}`}>
            {held ? hoursAndMinutes(state.running.todayOnTaskSeconds) : clockFace(elapsed)}
          </span>
          <span className="u-text-faint">
            {held ? t('timer.todayOnTask') : t('timer.thisSitting')}
          </span>
        </div>
        {held ? (
          <Button onClick={onResume} busy={busy}>
            {t('timer.resume')}
          </Button>
        ) : (
          <Button tone="secondary" onClick={onHold} busy={busy}>
            {t('timer.hold')}
          </Button>
        )}
        <Button tone="danger" onClick={onStop} busy={busy}>
          {t('timer.stop')}
        </Button>
      </div>
    </Card>
  );
}

function EntryRow({ entry }: { entry: TimeEntryView }) {
  const { t } = useTranslation();

  return (
    <div className="line">
      <span>{entry.clientName}</span>
      <span className="u-text-faint">{t(`services.${entry.service}`)}</span>
      <span className="u-grow" />
      {entry.source === 'manual' ? <Badge>{t('timer.manual')}</Badge> : null}
      {!entry.billable ? <Badge>{t('timer.nonBillable')}</Badge> : null}
      {entry.locked ? <Badge tone="accent">{t('timer.billed')}</Badge> : null}
      <span className="u-ltr u-numeric">{duration(entry.seconds, t)}</span>
    </div>
  );
}

/** Start button for a task, used from the client file. */
export function StartTimerButton({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const queries = useQueryClient();

  const start = useMutation({
    mutationFn: () => startTimer(taskId),
    onSuccess: (next) => queries.setQueryData(['timer'], next),
  });

  return (
    <Button small tone="secondary" onClick={() => start.mutate()} busy={start.isPending}>
      {t('timer.start')}
    </Button>
  );
}
