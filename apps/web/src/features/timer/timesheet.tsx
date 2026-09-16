import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Loading } from '../../design/index.js';
import { duration, hoursAndMinutes } from '../../lib/duration.js';
import { timesheet } from './api.js';

/** The seven days ending today, as calendar days. */
function lastSevenDays(offsetWeeks = 0): { from: string; to: string } {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + offsetWeeks * 7);
  const start = new Date(end.getTime() - 6 * 86_400_000);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/**
 * A person's own week (FR-24).
 *
 * Their own, always. Whose hours somebody may look at is a question about
 * management reporting, and it should not be answered by accident through a
 * query parameter.
 */
export function TimesheetPanel() {
  const { t } = useTranslation();
  const [weeksBack, setWeeksBack] = useState(0);
  const { from, to } = lastSevenDays(weeksBack);
  const sheet = useQuery({
    queryKey: ['timesheet', from, to],
    queryFn: () => timesheet(from, to),
  });

  const share =
    sheet.data && sheet.data.totalSeconds > 0
      ? Math.round((sheet.data.billableSeconds / sheet.data.totalSeconds) * 100)
      : null;

  return (
    <Card title={t('timer.week')} description={t('timer.weekHint')}>
      <div className="u-row u-spread">
        <span className="u-text-faint u-ltr u-numeric">
          {from} — {to}
        </span>
        <div className="u-row">
          <Button small tone="quiet" onClick={() => setWeeksBack(weeksBack - 1)}>
            {t('calendar.previous')}
          </Button>
          {weeksBack !== 0 ? (
            <Button small tone="quiet" onClick={() => setWeeksBack(0)}>
              {t('timer.thisWeek')}
            </Button>
          ) : null}
          <Button
            small
            tone="quiet"
            disabled={weeksBack >= 0}
            onClick={() => setWeeksBack(weeksBack + 1)}
          >
            {t('calendar.next')}
          </Button>
        </div>
      </div>

      {sheet.isLoading ? <Loading label={t('loading')} /> : null}
      {sheet.isError ? <p className="alert alert--error">{t('timer.failed')}</p> : null}

      {sheet.data ? (
        <>
          <div className="u-stack-tight">
            {sheet.data.days.map((day) => (
              <div key={day.day} className="line">
                <span className="u-ltr u-numeric u-text-faint">{day.day}</span>
                <span>{weekdayOf(day.day, t)}</span>
                <span className="u-grow" />
                {/*
                  A day with nothing on it is shown as a dash rather than 0:00.
                  A blank row is the point: it is what somebody is looking for
                  when they check whether they forgot to record something.
                */}
                {day.seconds === 0 ? (
                  <span className="u-text-faint">—</span>
                ) : (
                  <>
                    {day.billableSeconds < day.seconds ? (
                      <Badge>
                        {t('timer.billableOf', {
                          billable: duration(day.billableSeconds, t),
                        })}
                      </Badge>
                    ) : null}
                    <strong className="u-ltr u-numeric">{duration(day.seconds, t)}</strong>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="line totals">
            <strong>{t('timer.total')}</strong>
            <span className="u-grow" />
            {share !== null ? (
              <span className="u-text-soft">{t('timer.billableShare', { percent: share })}</span>
            ) : null}
            <strong className="u-ltr u-numeric">{hoursAndMinutes(sheet.data.totalSeconds)}</strong>
          </div>
        </>
      ) : null}
    </Card>
  );
}

function weekdayOf(day: string, t: (key: string) => string): string {
  const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const index = new Date(`${day}T00:00:00Z`).getUTCDay();
  return t(`calendar.weekdays.${names[index]}`);
}
