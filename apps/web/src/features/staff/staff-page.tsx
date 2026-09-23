import type { StaffMember } from '@amc/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Card, Empty, Loading } from '../../design/index.js';
import { duration } from '../../lib/duration.js';
import { staffDirectory } from './api.js';

/**
 * Who works here, and what they are carrying (X-01).
 *
 * A manager had to open four screens to ask "what is this person doing this
 * week". This is that question as one row per person.
 *
 * Two things the practice asked for are not here, because the system does not
 * hold them: leave, and the expiry of a member of staff's own documents.
 * Empty columns would suggest the data is on its way.
 */
export function StaffPage() {
  const { t } = useTranslation();
  const staff = useQuery({ queryKey: ['staff'], queryFn: staffDirectory });

  if (staff.isLoading) return <Loading label={t('loading')} />;
  if (staff.isError) return <Alert tone="error">{t('staff.failed')}</Alert>;

  const people = staff.data ?? [];
  // Whether hours came back at all is the permission answer: the server
  // removes them rather than zeroing them for somebody who may not see them.
  const showsHours = people.some((person) => person.thisMonthSeconds !== null);

  return (
    <Card title={t('staff.title')} description={t('staff.hint')}>
      {people.length === 0 ? <Empty title={t('staff.none')} /> : null}

      {people.length > 0 ? (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('staff.person')}</th>
                <th scope="col">{t('staff.hours')}</th>
                <th scope="col" className="table__figure">
                  {t('staff.clients')}
                </th>
                <th scope="col" className="table__figure">
                  {t('staff.work')}
                </th>
                {showsHours ? (
                  <>
                    <th scope="col" className="table__figure">
                      {t('staff.thisMonth')}
                    </th>
                    <th scope="col" className="table__figure">
                      {t('staff.lastMonth')}
                    </th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <StaffRow key={person.id} person={person} showsHours={showsHours} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

function StaffRow({ person, showsHours }: { person: StaffMember; showsHours: boolean }) {
  const { t } = useTranslation();

  return (
    <tr>
      <th scope="row">
        {person.displayName}
        <span className="u-block u-text-faint">
          {person.roles.map((role) => t(`roles.${role}`)).join(t('listSeparator'))}
        </span>
      </th>
      <td>
        {person.workingHours ? (
          <>
            {/* The clock face reads the same in both languages, and a range
                is one run of digits: isolated so Arabic does not reverse it. */}
            <span className="u-ltr u-numeric">
              {person.workingHours.startsAt}–{person.workingHours.endsAt}
            </span>
            <span className="u-block u-text-faint">
              {person.workingHours.days.map((day) => t(`weekdaysShort.${day}`)).join(' ')}
            </span>
          </>
        ) : (
          <span className="u-text-faint">{t('staff.noHours')}</span>
        )}
      </td>
      <td className="table__figure u-numeric">{person.clients}</td>
      <td className="table__figure u-numeric">
        {person.openProjects}
        {person.overdueProjects > 0 ? (
          <span className="u-block">
            <Badge tone="danger">{t('staff.overdue', { count: person.overdueProjects })}</Badge>
          </span>
        ) : null}
      </td>
      {showsHours ? (
        <>
          <td className="table__figure u-numeric">{duration(person.thisMonthSeconds ?? 0, t)}</td>
          <td className="table__figure u-numeric">{duration(person.lastMonthSeconds ?? 0, t)}</td>
        </>
      ) : null}
    </tr>
  );
}
