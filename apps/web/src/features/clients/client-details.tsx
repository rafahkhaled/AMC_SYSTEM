import type { ChangeClientDetails, ClientDetail } from '@amc/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Field, Select } from '../../design/index.js';
import { storeCredential } from '../vault/api.js';
import { changeClientDetails } from './api.js';

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * Who to call at a client, the numbers the firm quotes back, and the weekly day
 * off. Shown to everyone who can see the client; editable by people who may
 * edit clients.
 */
export function ClientDetailsCard({
  detail,
  canEdit,
  months,
}: {
  detail: ClientDetail;
  canEdit: boolean;
  months: readonly string[];
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const dayName = (day: number | null) => (day === null ? null : t(`clients.days.${day}`));

  if (editing) {
    return <DetailsForm detail={detail} months={months} onDone={() => setEditing(false)} />;
  }

  return (
    <Card title={t('clients.contactTitle')}>
      <dl className="facts">
        <Row label={t('clients.contactPerson')} value={detail.contactPerson} />
        <Row label={t('clients.email')} value={detail.contactEmail} ltr />
        <Row label={t('clients.mobile')} value={detail.mobile} ltr />
        <Row label={t('clients.landline')} value={detail.landline} ltr />
        <Row label={t('clients.dayOff')} value={dayName(detail.weeklyDayOff)} />
        <Row
          label={t('clients.hours')}
          value={
            detail.opensAt && detail.closesAt ? `${detail.opensAt} – ${detail.closesAt}` : null
          }
          ltr
        />
        <Row label={t('clients.address')} value={detail.address} />
        {detail.references.map((reference) => (
          <Row key={reference.label} label={reference.label} value={reference.value} ltr />
        ))}
      </dl>
      {canEdit ? (
        <div className="u-row">
          <Button small tone="secondary" onClick={() => setEditing(true)}>
            {t('clients.editDetails')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function Row({ label, value, ltr }: { label: string; value: string | null; ltr?: boolean }) {
  return (
    <div className="fact">
      <dt className="u-text-faint">{label}</dt>
      {/* Isolated rather than turned left-to-right, so an email or a number
          sits under its label like every other value instead of at the far
          side of the row. */}
      <dd className="u-typed">{value ? ltr ? <bdi dir="ltr">{value}</bdi> : value : '—'}</dd>
    </div>
  );
}

function DetailsForm({
  detail,
  months,
  onDone,
}: {
  detail: ClientDetail;
  months: readonly string[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const queries = useQueryClient();

  const [licence, setLicence] = useState(detail.tradeLicenceNumber ?? '');
  const [person, setPerson] = useState(detail.contactPerson ?? '');
  const [email, setEmail] = useState(detail.contactEmail ?? '');
  const [mobile, setMobile] = useState(detail.mobile ?? '');
  const [landline, setLandline] = useState(detail.landline ?? '');
  const [dayOff, setDayOff] = useState(
    detail.weeklyDayOff === null ? '' : String(detail.weeklyDayOff),
  );
  const [address, setAddress] = useState(detail.address ?? '');
  const [opensAt, setOpensAt] = useState(detail.opensAt ?? '');
  const [closesAt, setClosesAt] = useState(detail.closesAt ?? '');
  const [references, setReferences] = useState(detail.references.map((r) => ({ ...r })));
  const [vatTrn, setVatTrn] = useState(detail.vatTrn ?? remarkText(detail.vatRemark));
  const [loginMethod, setLoginMethod] = useState(detail.taxLoginMethod ?? '');
  const [taxPassword, setTaxPassword] = useState('');
  const [booksPassword, setBooksPassword] = useState('');
  const [frequency, setFrequency] = useState<'monthly' | 'quarterly'>('quarterly');
  const [periodEnd, setPeriodEnd] = useState('3');
  const [ctTrn, setCtTrn] = useState(detail.ctTrn ?? remarkText(detail.ctRemark));
  const [yearEnd, setYearEnd] = useState('12');

  const vatRegistered = detail.vatState === 'registered';
  const ctRegistered = detail.ctState === 'registered';

  const save = useMutation({
    mutationFn: async () => {
      const text = (value: string) => (value.trim() === '' ? null : value.trim());
      const body: ChangeClientDetails = {
        tradeLicenceNumber: text(licence),
        contactPerson: text(person),
        contactEmail: text(email),
        mobile: text(mobile),
        landline: text(landline),
        weeklyDayOff: dayOff === '' ? null : Number(dayOff),
        address: text(address),
        opensAt: text(opensAt),
        closesAt: text(closesAt),
        references: references.filter((r) => r.label.trim() !== '' && r.value.trim() !== ''),
      };
      // A number is sent only when it was typed or changed. For a client not yet
      // registered it also carries the cycle that gives the deadline a date.
      body.taxLoginMethod = loginMethod === '' ? null : (loginMethod as 'email' | 'uae_pass');
      // NA or Rejection in the number box is a remark, not a number.
      const vatRemark = remarkOf(vatTrn);
      const ctRemark = remarkOf(ctTrn);
      body.vatRemark = vatRemark;
      body.ctRemark = ctRemark;
      if (!vatRemark && vatTrn.trim() !== '' && vatTrn.trim() !== (detail.vatTrn ?? '')) {
        body.vat = {
          trn: vatTrn.trim(),
          ...(vatRegistered ? {} : { frequency, anchorEndMonth: Number(periodEnd) }),
        };
      }
      if (!ctRemark && ctTrn.trim() !== '' && ctTrn.trim() !== (detail.ctTrn ?? '')) {
        body.corporateTax = {
          trn: ctTrn.trim(),
          ...(ctRegistered ? {} : { financialYearEndMonth: Number(yearEnd) }),
        };
      }
      const updated = await changeClientDetails(detail.id, body);
      // The passwords go to the vault, encrypted, never onto the client record.
      const login = text(email) ?? (loginMethod === 'uae_pass' ? 'UAE PASS' : '—');
      if (taxPassword) {
        await storeCredential(detail.id, {
          kind: 'emaratax',
          username: login,
          secret: taxPassword,
          ...(loginMethod === 'uae_pass' ? { note: 'UAE PASS' } : {}),
        });
      }
      if (booksPassword) {
        await storeCredential(detail.id, {
          kind: 'accounting_software',
          username: login,
          secret: booksPassword,
        });
      }
      return updated;
    },
    onSuccess: (updated) => {
      queries.setQueryData(['clients', detail.id], updated);
      void queries.invalidateQueries({ queryKey: ['clients'] });
      onDone();
    },
  });

  const monthOptions = months.map((name, index) => (
    <option key={name} value={String(index + 1)}>
      {name}
    </option>
  ));

  return (
    <Card title={t('clients.editDetails')} description={t('clients.passwordsHint')}>
      <form
        className="u-stack-tight"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Field
          label={t('clients.contactPerson')}
          value={person}
          onChange={(e) => setPerson(e.target.value)}
        />
        <Field
          label={t('clients.email')}
          hint={t('clients.emailOptional')}
          ltr
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label={t('clients.taxLogin')}
          control={(props) => (
            <Select {...props} value={loginMethod} onChange={(e) => setLoginMethod(e.target.value)}>
              <option value="">{t('clients.noDayOff')}</option>
              <option value="email">{t('clients.taxLoginEmail')}</option>
              <option value="uae_pass">UAE PASS</option>
            </Select>
          )}
        />
        <Field
          label={t('clients.taxPassword')}
          hint={t('clients.passwordKept')}
          type="password"
          autoComplete="new-password"
          ltr
          value={taxPassword}
          onChange={(e) => setTaxPassword(e.target.value)}
        />
        <Field
          label={t('clients.booksPassword')}
          type="password"
          autoComplete="new-password"
          ltr
          value={booksPassword}
          onChange={(e) => setBooksPassword(e.target.value)}
        />
        <Field
          label={t('clients.mobile')}
          ltr
          inputMode="tel"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
        />
        <Field
          label={t('clients.landline')}
          ltr
          inputMode="tel"
          value={landline}
          onChange={(e) => setLandline(e.target.value)}
        />
        <Field
          label={t('clients.dayOff')}
          control={(
            props: Parameters<NonNullable<React.ComponentProps<typeof Field>['control']>>[0],
          ) => (
            <Select {...props} value={dayOff} onChange={(e) => setDayOff(e.target.value)}>
              <option value="">{t('clients.noDayOff')}</option>
              {DAYS.map((day) => (
                <option key={day} value={String(day)}>
                  {t(`clients.days.${day}`)}
                </option>
              ))}
            </Select>
          )}
        />

        <Field
          label={t('clients.address')}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <div className="u-row u-row-top">
          <Field
            label={t('clients.opensAt')}
            ltr
            type="time"
            value={opensAt}
            onChange={(e) => setOpensAt(e.target.value)}
          />
          <Field
            label={t('clients.closesAt')}
            ltr
            type="time"
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
          />
        </div>

        <Field
          label={t('clients.licence')}
          ltr
          value={licence}
          onChange={(e) => setLicence(e.target.value)}
        />
        <Field
          label={t('clients.vatNumber')}
          hint={t('clients.trnHint')}
          ltr
          value={vatTrn}
          onChange={(e) => setVatTrn(e.target.value)}
        />
        {!vatRegistered && vatTrn.trim() !== '' && !remarkOf(vatTrn) ? (
          <div className="u-row">
            <Field
              label={t('clients.vatHowOften')}
              control={(
                props: Parameters<NonNullable<React.ComponentProps<typeof Field>['control']>>[0],
              ) => (
                <Select
                  {...props}
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as 'monthly' | 'quarterly')}
                >
                  <option value="monthly">{t('clients.monthly')}</option>
                  <option value="quarterly">{t('clients.quarterly')}</option>
                </Select>
              )}
            />
            <Field
              label={t('clients.periodEnd')}
              control={(
                props: Parameters<NonNullable<React.ComponentProps<typeof Field>['control']>>[0],
              ) => (
                <Select {...props} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)}>
                  {monthOptions}
                </Select>
              )}
            />
          </div>
        ) : null}
        <Field
          label={t('clients.ctNumber')}
          hint={t('clients.trnHint')}
          ltr
          value={ctTrn}
          onChange={(e) => setCtTrn(e.target.value)}
        />
        {!ctRegistered && ctTrn.trim() !== '' && !remarkOf(ctTrn) ? (
          <Field
            label={t('clients.financialYear')}
            control={(
              props: Parameters<NonNullable<React.ComponentProps<typeof Field>['control']>>[0],
            ) => (
              <Select {...props} value={yearEnd} onChange={(e) => setYearEnd(e.target.value)}>
                {monthOptions}
              </Select>
            )}
          />
        ) : null}

        <fieldset className="u-stack-tight">
          <legend>{t('clients.references')}</legend>
          <p className="u-text-faint">{t('clients.referencesHint')}</p>
          {references.map((reference, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity until saved
            <div className="u-row" key={index}>
              <Field
                label={t('clients.refLabel')}
                value={reference.label}
                onChange={(e) =>
                  setReferences(
                    references.map((r, i) => (i === index ? { ...r, label: e.target.value } : r)),
                  )
                }
              />
              <Field
                label={t('clients.refValue')}
                ltr
                value={reference.value}
                onChange={(e) =>
                  setReferences(
                    references.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)),
                  )
                }
              />
              <Button
                small
                tone="quiet"
                type="button"
                onClick={() => setReferences(references.filter((_, i) => i !== index))}
              >
                {t('clients.removeReference')}
              </Button>
            </div>
          ))}
          <Button
            small
            tone="secondary"
            type="button"
            onClick={() => setReferences([...references, { label: '', value: '' }])}
          >
            {t('clients.addReference')}
          </Button>
        </fieldset>

        {save.isError ? <Alert tone="error">{(save.error as Error).message}</Alert> : null}
        <div className="u-row">
          <Button type="submit" busy={save.isPending}>
            {t('clients.saveDetails')}
          </Button>
          <Button tone="quiet" type="button" onClick={onDone}>
            {t('clients.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** What NA or Rejection typed in a tax number box means. */
function remarkOf(typed: string): 'na' | 'rejected' | null {
  const value = typed.trim().toLowerCase();
  if (value === 'na' || value === 'n/a') return 'na';
  if (value.startsWith('reject') || value.startsWith('regect') || value === 'مرفوض')
    return 'rejected';
  return null;
}

function remarkText(remark: string | null): string {
  return remark === 'na' ? 'NA' : remark === 'rejected' ? 'Rejection' : '';
}
