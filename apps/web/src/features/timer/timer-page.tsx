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
  confirmEntry,
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
  const confirm = useMutation({ mutationFn: confirmEntry, onSuccess: settle });

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
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  onConfirm={() => confirm.mutate(entry.id)}
                  confirming={confirm.isPending}
                />
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
  const idle = useIdle(Boolean(state.running) && !held);

  useEffect(() => {
    if (!state.running) return;
    setElapsed(state.running.elapsedSeconds);
    // A held timer counts nothing, so there is nothing to tick and no reason
    // to tell the server a paused tab is still awake.
    if (held) return;

    const tick = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    /*
     * The heartbeat stops when nobody has touched anything for a while. That
     * is the whole mechanism: the server already trims a timer with no
     * heartbeat back to the last one it saw, so going quiet is how an
     * unattended clock stops billing. Telling the server "still here" while
     * the room is empty would be the lie.
     */
    const pulse = setInterval(() => {
      if (!idle) void beat();
    }, 60_000);

    return () => {
      clearInterval(tick);
      clearInterval(pulse);
    };
  }, [state.running, held, idle]);

  if (!state.running) {
    return (
      <Card title={t('timer.title')}>
        <Empty title={t('timer.notRunning')} description={t('timer.startHint')} />
      </Card>
    );
  }

  return (
    <Card title={t('timer.title')}>
      {idle ? <Alert tone="warning">{t('timer.idle', { minutes: IDLE_MINUTES })}</Alert> : null}
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

function EntryRow({
  entry,
  onConfirm,
  confirming,
}: {
  entry: TimeEntryView;
  onConfirm: () => void;
  confirming: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="line">
      <span>{entry.clientName}</span>
      <span className="u-text-faint">{t(`services.${entry.service}`)}</span>
      <span className="u-grow" />
      {entry.source === 'manual' ? <Badge>{t('timer.manual')}</Badge> : null}
      {!entry.billable ? <Badge>{t('timer.nonBillable')}</Badge> : null}
      {entry.locked ? <Badge tone="accent">{t('timer.billed')}</Badge> : null}
      {/*
        A flagged entry is real time — it is on the timesheet and counted —
        but it cannot be billed until the person who was there says it is
        right. The question is put next to the entry rather than in a list
        somewhere else, because it is answerable in one glance.
      */}
      {entry.reviewReason ? (
        <>
          <Badge tone="warning">{t(`timer.review.${entry.reviewReason}`)}</Badge>
          <Button small tone="secondary" busy={confirming} onClick={onConfirm}>
            {t('timer.review.confirm')}
          </Button>
        </>
      ) : null}
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

/**
 * How long without a sign of life before a timer is treated as unattended.
 *
 * Long enough that reading a long document does not trip it, short enough that
 * a forgotten clock does not run all afternoon. It is not a hard rule: the
 * time is still recorded, trimmed back to the last heartbeat, and the person
 * is asked to confirm it.
 */
const IDLE_MINUTES = 10;

/**
 * Whether the person appears to have walked away.
 *
 * Watches for the things somebody actually does: moving a pointer, pressing a
 * key, touching the screen, or bringing the tab back to the front. Scrolling
 * counts, because reading is working.
 *
 * Going idle does not stop the timer. It stops the heartbeat, and the server
 * already trims a timer it has not heard from back to the last beat it saw.
 * Saying "still here" while the room is empty would be the lie.
 */
function useIdle(watching: boolean): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!watching) {
      setIdle(false);
      return;
    }

    let last = Date.now();
    const awake = () => {
      last = Date.now();
      setIdle(false);
    };

    const events = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'] as const;
    for (const event of events) window.addEventListener(event, awake, { passive: true });
    document.addEventListener('visibilitychange', awake);

    const check = setInterval(() => {
      setIdle(Date.now() - last > IDLE_MINUTES * 60_000);
    }, 30_000);

    return () => {
      for (const event of events) window.removeEventListener(event, awake);
      document.removeEventListener('visibilitychange', awake);
      clearInterval(check);
    };
  }, [watching]);

  return idle;
}
