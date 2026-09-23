import type { StaffMember } from '@amc/contracts';
import { staffRoles } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Empty, Field, Loading } from '../../design/index.js';
import { duration } from '../../lib/duration.js';
import { addStaff, setStaffStatus, staffDirectory, updateStaff } from './api.js';

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
export function StaffPage({ canManage = false }: { canManage?: boolean }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | null>(null);
  const staff = useQuery({ queryKey: ['staff'], queryFn: staffDirectory });

  if (staff.isLoading) return <Loading label={t('loading')} />;
  if (staff.isError) return <Alert tone="error">{t('staff.failed')}</Alert>;

  const people = staff.data ?? [];
  // Whether hours came back at all is the permission answer: the server
  // removes them rather than zeroing them for somebody who may not see them.
  const showsHours = people.some((person) => person.thisMonthSeconds !== null);

  return (
    <div className="u-stack">
      {canManage ? <AddStaff /> : null}

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
                  {canManage ? <th scope="col">{t('staff.manage')}</th> : null}
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <StaffRow
                    key={person.id}
                    person={person}
                    showsHours={showsHours}
                    canManage={canManage}
                    onEdit={() => setEditing(person.id === editing ? null : person.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {editing ? (
        <EditStaff
          person={people.find((one) => one.id === editing) ?? null}
          onDone={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function StaffRow({
  person,
  showsHours,
  canManage,
  onEdit,
}: {
  person: StaffMember;
  showsHours: boolean;
  canManage: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();

  return (
    <tr>
      <th scope="row">
        {person.displayName}
        <span className="u-block u-text-faint">
          {person.roles.map((role) => t(`roles.${role}`)).join(t('listSeparator'))}
        </span>
        {person.status === 'suspended' ? (
          <span className="u-block">
            <Badge tone="neutral">{t('staff.suspended')}</Badge>
          </span>
        ) : null}
      </th>
      <td className="staff__hours">
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
      {canManage ? (
        <td>
          <Button small tone="quiet" onClick={onEdit}>
            {t('staff.edit')}
          </Button>
        </td>
      ) : null}
    </tr>
  );
}

/**
 * Adding a colleague (FR-03).
 *
 * The password is set here and expected to be changed by the person. There is
 * no invitation email yet, and an account nobody can get into would be worse
 * than one whose first password somebody had to hand over.
 */
function AddStaff() {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<string>('accountant');

  const add = useMutation({
    mutationFn: () => addStaff({ email, displayName, password, roles: [role] }),
    onSuccess: (staff) => {
      queries.setQueryData(['staff'], staff);
      setOpen(false);
      setEmail('');
      setDisplayName('');
      setPassword('');
    },
  });

  if (!open) {
    return (
      <div className="u-row">
        <Button onClick={() => setOpen(true)}>{t('staff.add.open')}</Button>
      </div>
    );
  }

  return (
    <Card title={t('staff.add.title')} description={t('staff.add.hint')}>
      <form
        className="u-stack-tight"
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate();
        }}
      >
        <Field
          label={t('staff.add.name')}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <Field
          label={t('staff.add.email')}
          type="email"
          ltr
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Field
          label={t('staff.add.password')}
          hint={t('staff.add.passwordHint')}
          type="password"
          ltr
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Field
          label={t('staff.add.role')}
          control={(props) => (
            <select
              {...props}
              className="input"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {staffRoles.map((name) => (
                <option key={name} value={name}>
                  {t(`roles.${name}`)}
                </option>
              ))}
            </select>
          )}
        />

        {/* The server's words: it refuses a weak password and an address
            somebody already uses, and both are worth reading exactly. */}
        {add.isError ? <Alert tone="error">{(add.error as Error).message}</Alert> : null}

        <div className="u-row">
          <Button type="submit" busy={add.isPending} disabled={!email || !displayName}>
            {t('staff.add.submit')}
          </Button>
          <Button tone="quiet" onClick={() => setOpen(false)}>
            {t('staff.add.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Correcting somebody's record.
 *
 * Name, role and working hours together, because they are one act: somebody
 * opened a person's record and put it right.
 */
function EditStaff({ person, onDone }: { person: StaffMember | null; onDone: () => void }) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const [displayName, setDisplayName] = useState(person?.displayName ?? '');
  const [role, setRole] = useState(person?.roles[0] ?? 'accountant');
  const [startsAt, setStartsAt] = useState(person?.workingHours?.startsAt ?? '09:00');
  const [endsAt, setEndsAt] = useState(person?.workingHours?.endsAt ?? '18:00');
  const [days, setDays] = useState<number[]>(person?.workingHours?.days ?? [1, 2, 3, 4, 5]);

  const save = useMutation({
    mutationFn: () =>
      updateStaff(person?.id ?? '', {
        displayName,
        roles: [role],
        workingHours: { startsAt, endsAt, days: [...days].sort() },
      }),
    onSuccess: (staff) => {
      queries.setQueryData(['staff'], staff);
      onDone();
    },
  });

  const status = useMutation({
    mutationFn: (next: 'active' | 'suspended') => setStaffStatus(person?.id ?? '', next),
    onSuccess: (staff) => {
      queries.setQueryData(['staff'], staff);
      onDone();
    },
  });

  if (!person) return null;

  return (
    <Card title={t('staff.editing', { name: person.displayName })}>
      <form
        className="u-stack-tight"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Field
          label={t('staff.add.name')}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <Field
          label={t('staff.add.role')}
          control={(props) => (
            <select
              {...props}
              className="input"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {staffRoles.map((name) => (
                <option key={name} value={name}>
                  {t(`roles.${name}`)}
                </option>
              ))}
            </select>
          )}
        />

        <div className="u-row">
          <Field
            label={t('staff.startsAt')}
            type="time"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
          <Field
            label={t('staff.endsAt')}
            type="time"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
        </div>

        <fieldset className="u-row u-row--tight">
          <legend className="field__label">{t('staff.workingDays')}</legend>
          {WEEKDAYS.map((day) => (
            <label key={day} className="choice">
              <input
                type="checkbox"
                checked={days.includes(day)}
                onChange={() =>
                  setDays(days.includes(day) ? days.filter((one) => one !== day) : [...days, day])
                }
              />
              {t(`weekdaysShort.${day}`)}
            </label>
          ))}
        </fieldset>

        {save.isError ? <Alert tone="error">{(save.error as Error).message}</Alert> : null}
        {status.isError ? <Alert tone="error">{(status.error as Error).message}</Alert> : null}

        <div className="u-row">
          <Button type="submit" busy={save.isPending} disabled={days.length === 0}>
            {t('staff.save')}
          </Button>
          {/* Suspend, not delete. Their id is on every hour they recorded. */}
          <Button
            tone={person.status === 'suspended' ? 'secondary' : 'danger'}
            busy={status.isPending}
            onClick={() => status.mutate(person.status === 'suspended' ? 'active' : 'suspended')}
          >
            {person.status === 'suspended' ? t('staff.reinstate') : t('staff.suspend')}
          </Button>
          <Button tone="quiet" onClick={onDone}>
            {t('staff.add.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
