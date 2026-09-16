import type { CalendarEntry, CalendarMonth } from '@amc/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Empty, Loading } from '../../design/index.js';
import { calendarMonth, monthOf, shiftMonth } from './api.js';

/**
 * The month ahead.
 *
 * Every date shown has the business calendar applied, so it is the day
 * something can actually be filed by rather than the day the law names. Where
 * the two differ the entry says so, because "the 30th, because the 28th was
 * Eid" is a sentence a client understands and a bare date is not.
 */
export function CalendarPage({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState(() => monthOf(new Date()));
  const view = useQuery({ queryKey: ['calendar', month], queryFn: () => calendarMonth(month) });

  const heading = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar-AE' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));

  return (
    <div className="u-stack">
      <div className="u-row u-spread">
        <h1 className="calendar__heading">{heading}</h1>
        <div className="u-row">
          <Button small tone="quiet" onClick={() => setMonth(shiftMonth(month, -1))}>
            {t('calendar.previous')}
          </Button>
          <Button small tone="quiet" onClick={() => setMonth(monthOf(new Date()))}>
            {t('calendar.thisMonth')}
          </Button>
          <Button small tone="quiet" onClick={() => setMonth(shiftMonth(month, 1))}>
            {t('calendar.next')}
          </Button>
        </div>
      </div>

      {view.isLoading ? <Loading label={t('loading')} /> : null}
      {view.isError ? <p className="alert alert--error">{t('calendar.failed')}</p> : null}
      {view.data ? <Month view={view.data} onOpenTask={onOpenTask} /> : null}
    </div>
  );
}

function Month({
  view,
  onOpenTask,
}: {
  view: CalendarMonth;
  onOpenTask: (taskId: string) => void;
}) {
  const { t } = useTranslation();

  /*
   * Where the first of the month sits in its week.
   *
   * The first day is pushed into the right column rather than being preceded
   * by blank cells: no spacer elements to key, and grid columns follow the
   * writing direction, so column one is the rightmost in Arabic without a
   * single direction rule.
   *
   * The week starts on Monday, which is how a working week is read here. The
   * UAE weekend is Saturday and Sunday, and keeping the two together at the
   * end is what makes a quiet Friday obvious at a glance.
   */
  const first = view.days[0];
  const startsAt = first ? ((new Date(`${first.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1 : 1;

  return (
    <>
      {view.overdue.length > 0 ? (
        <Card title={t('calendar.overdue')} description={t('calendar.overdueHint')}>
          <div className="u-stack-tight">
            {view.overdue.map((entry) => (
              <div key={entry.id} className="line">
                <span className="u-ltr u-numeric u-danger">{entry.dueOn}</span>
                <span>{entry.clientName}</span>
                <span className="u-text-faint">{subjectOf(entry, t)}</span>
                <span className="u-grow" />
                {entry.taskId ? (
                  <Button small tone="quiet" onClick={() => onOpenTask(entry.taskId as string)}>
                    {t('calendar.open')}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="calendar">
        {['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => (
          <div key={day} className="calendar__weekday">
            {t(`calendar.weekdays.${day}`)}
          </div>
        ))}

        {view.days.map((day, index) => (
          <div
            key={day.date}
            className={`calendar__cell${day.isWeekend ? ' calendar__cell--weekend' : ''}${
              day.holiday ? ' calendar__cell--holiday' : ''
            }`}
            style={index === 0 ? { gridColumnStart: startsAt } : undefined}
          >
            <div className="calendar__date">
              <span className="u-numeric">{Number(day.date.slice(8))}</span>
              {day.holiday ? <HolidayName holiday={day.holiday} /> : null}
            </div>
            {day.entries.map((entry) => (
              <Entry key={entry.id} entry={entry} onOpen={onOpenTask} />
            ))}
          </div>
        ))}
      </div>

      {view.days.every((day) => day.entries.length === 0) ? (
        <Empty title={t('calendar.nothing')} description={t('calendar.nothingHint')} />
      ) : null}
    </>
  );
}

function HolidayName({ holiday }: { holiday: { nameEn: string; nameAr: string } }) {
  const { i18n } = useTranslation();
  return (
    <span className="calendar__holiday">
      {i18n.language === 'ar' ? holiday.nameAr : holiday.nameEn}
    </span>
  );
}

function Entry({ entry, onOpen }: { entry: CalendarEntry; onOpen: (taskId: string) => void }) {
  const { t } = useTranslation();

  const tone = entry.kind === 'document_expiry' ? 'warning' : entry.isOverdue ? 'danger' : 'accent';

  const subject = subjectOf(entry, t);
  const body = (
    <>
      <span className="calendar__client">{entry.clientName}</span>
      <Badge tone={entry.isDone ? 'neutral' : tone}>{subject}</Badge>
      {entry.movedBecause ? (
        <span className="calendar__moved">
          {t(`calendar.movedOff.${entry.movedBecause}`, { statutory: entry.statutoryOn })}
        </span>
      ) : null}
    </>
  );

  // The cell clips both the name and the label, so the whole thing is on the
  // title where a person can still reach it.
  const full = `${entry.clientName} — ${subject}`;

  if (!entry.taskId) {
    return (
      <div className="calendar__entry" title={full}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="calendar__entry calendar__entry--link"
      title={full}
      onClick={() => onOpen(entry.taskId as string)}
    >
      {body}
    </button>
  );
}

/** A service code or a document type, whichever this entry is about. */
function subjectOf(entry: CalendarEntry, t: (key: string) => string): string {
  return entry.kind === 'document_expiry'
    ? t(`documentTypes.${entry.subject}`)
    : t(`services.${entry.subject}`);
}
