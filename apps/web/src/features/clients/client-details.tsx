import type { ChangeClientDetails, ClientDetail } from '@amc/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Field, Select } from '../../design/index.js';
import { inReadersLanguage } from '../../lib/server-messages.js';
import { useDraft } from '../../lib/use-draft.js';
import { storeCredential } from '../vault/api.js';
import { changeClientDetails } from './api.js';

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** The words the firm writes beside a return. Offered, not imposed. */
export const RETURN_STATUSES = [
  'Done',
  'To be Done',
  'Rejection',
  'De Registration',
  'In progress',
] as const;

type ControlProps = Parameters<NonNullable<React.ComponentProps<typeof Field>['control']>>[0];

/**
 * Who to call at a client, the numbers the firm quotes back, and the weekly day
 * off. Shown to everyone who can see the client; editable by people who may
 * edit clients.
 */
export function ClientDetailsCard({
  detail,
  canEdit,
  months,
  children,
}: {
  detail: ClientDetail;
  canEdit: boolean;
  months: readonly string[];
  /** What else belongs with the details: the client's logins. */
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const dayName = (day: number | null) => (day === null ? null : t(`clients.days.${day}`));

  if (editing) {
    return <DetailsForm detail={detail} months={months} onDone={() => setEditing(false)} />;
  }

  return (
    <Card title={t('clients.contactTitle')}>
      {/* What the firm reaches for, first; the email on a row of its own so
          a long address reads whole instead of squeezed into a column. */}
      <dl className="facts">
        <Row label={t('clients.email')} value={detail.contactEmail} ltr wide />
        <Row label={t('clients.contactPerson')} value={detail.contactPerson} />
        <Row label={t('clients.mobile')} value={detail.mobile} ltr />
        {detail.mobile2 ? <Row label={t('clients.mobile2')} value={detail.mobile2} ltr /> : null}
        <Row label={t('clients.address')} value={detail.address} />
        {detail.references.map((reference) => (
          <Row key={reference.label} label={reference.label} value={reference.value} ltr />
        ))}
      </dl>
      {/* Seldom needed, so below and quieter. */}
      <h3 className="subheading">{t('clients.moreContact')}</h3>
      <dl className="facts">
        <Row label={t('clients.landline')} value={detail.landline} ltr />
        <Row label={t('clients.dayOff')} value={dayName(detail.weeklyDayOff)} />
        <Row
          label={t('clients.hours')}
          value={
            detail.opensAt && detail.closesAt ? `${detail.opensAt} – ${detail.closesAt}` : null
          }
          ltr
        />
      </dl>
      {canEdit ? (
        <div className="u-row">
          <Button small tone="secondary" onClick={() => setEditing(true)}>
            {t('clients.editDetails')}
          </Button>
        </div>
      ) : null}
      {children}
    </Card>
  );
}

function Row({
  label,
  value,
  ltr,
  wide,
}: {
  label: string;
  value: string | null;
  ltr?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'fact fact--wide' : 'fact'}>
      <dt className="u-text-faint">{label}</dt>
      {/* Isolated rather than turned left-to-right, so an email or a number
          sits under its label like every other value instead of at the far
          side of the row. */}
      {/* Aligned with the page, not with the value's own language: "plaintext"
          put every English name and email at the far side of its box. The bdi
          still lets each value read in its own direction. */}
      <dd>{value ? <bdi dir={ltr ? 'ltr' : 'auto'}>{value}</bdi> : '—'}</dd>
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

  const [legalName, setLegalName] = useState(detail.legalName);
  const [legalNameArabic, setLegalNameArabic] = useState(detail.legalNameArabic ?? '');
  const [licence, setLicence] = useState(detail.tradeLicenceNumber ?? '');
  const [person, setPerson] = useState(detail.contactPerson ?? '');
  const [email, setEmail] = useState(detail.contactEmail ?? '');
  const [mobile, setMobile] = useState(detail.mobile ?? '');
  const [landline, setLandline] = useState(detail.landline ?? '');
  const [mobile2, setMobile2] = useState(detail.mobile2 ?? '');
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
  const [booksUser, setBooksUser] = useState('');
  const [booksPassword, setBooksPassword] = useState('');
  // The months as they are on file; nothing is assumed for a client without
  // them, because a guess (March, June…) was saved as if it were known.
  const onFile = detail.vatPeriodEndMonths;
  const [frequency, setFrequency] = useState<'monthly' | 'quarterly'>(
    onFile.length === 12 ? 'monthly' : 'quarterly',
  );
  const [periodEnd, setPeriodEnd] = useState(onFile.length > 0 ? String(onFile[0]) : '');
  const [ctTrn, setCtTrn] = useState(detail.ctTrn ?? remarkText(detail.ctRemark));
  const [yearEnd, setYearEnd] = useState('12');
  const [ctDueOn, setCtDueOn] = useState(detail.ctReturnDueOn ?? '');
  // Four returns a year, each with the day it is due and the day it went in.
  const [vatReturns, setVatReturns] = useState(
    [0, 1, 2, 3].map((index) => ({
      dueOn: detail.vatReturns[index]?.dueOn ?? '',
      filedOn: detail.vatReturns[index]?.filedOn ?? '',
      status: detail.vatReturns[index]?.status ?? '',
    })),
  );
  const setVatReturn = (index: number, part: 'dueOn' | 'filedOn' | 'status', value: string) =>
    setVatReturns((now) => now.map((one, i) => (i === index ? { ...one, [part]: value } : one)));
  /*
   * Choosing the months a quarter ends in also dates the four returns: each is
   * due on the 28th of the month after its quarter ends. The two are one fact,
   * and typed separately they had come to disagree.
   */
  const chooseQuarterEnd = (month: string) => {
    setPeriodEnd(month);
    if (month === '') return;
    const due = returnDueDates(quarterMonths(Number(month)), new Date());
    setVatReturns((now) => now.map((one, i) => ({ ...one, dueOn: due[i] ?? one.dueOn })));
  };
  const [ctFiledOn, setCtFiledOn] = useState(detail.ctReturnFiledOn ?? '');
  const [ctStatus, setCtStatus] = useState(detail.ctReturnStatus ?? '');
  const [missingMonths, setMissingMonths] = useState(false);
  /** Which tax number was sent, so a refusal about "a tax number" lands on the right box. */
  const [sentTax, setSentTax] = useState<'vat' | 'ct' | null>(null);

  // Everything typed, bar the passwords, kept until it is saved.
  const draft = useDraft(
    `client-details.${detail.id}`,
    {
      legalName,
      legalNameArabic,
      licence,
      person,
      email,
      mobile,
      landline,
      mobile2,
      dayOff,
      address,
      opensAt,
      closesAt,
      references,
      vatTrn,
      loginMethod,
      frequency,
      periodEnd,
      ctTrn,
      yearEnd,
      ctDueOn,
      ctFiledOn,
      ctStatus,
      vatReturns,
      booksUser,
    },
    (saved) => {
      if (saved.legalName !== undefined) setLegalName(saved.legalName);
      if (saved.legalNameArabic !== undefined) setLegalNameArabic(saved.legalNameArabic);
      if (saved.licence !== undefined) setLicence(saved.licence);
      if (saved.person !== undefined) setPerson(saved.person);
      if (saved.email !== undefined) setEmail(saved.email);
      if (saved.mobile !== undefined) setMobile(saved.mobile);
      if (saved.landline !== undefined) setLandline(saved.landline);
      if (saved.mobile2 !== undefined) setMobile2(saved.mobile2);
      if (saved.dayOff !== undefined) setDayOff(saved.dayOff);
      if (saved.address !== undefined) setAddress(saved.address);
      if (saved.opensAt !== undefined) setOpensAt(saved.opensAt);
      if (saved.closesAt !== undefined) setClosesAt(saved.closesAt);
      if (saved.references !== undefined) setReferences(saved.references);
      if (saved.vatTrn !== undefined) setVatTrn(saved.vatTrn);
      if (saved.loginMethod !== undefined) setLoginMethod(saved.loginMethod);
      if (saved.frequency !== undefined) setFrequency(saved.frequency);
      if (saved.periodEnd !== undefined) setPeriodEnd(saved.periodEnd);
      if (saved.ctTrn !== undefined) setCtTrn(saved.ctTrn);
      if (saved.yearEnd !== undefined) setYearEnd(saved.yearEnd);
      if (saved.ctDueOn !== undefined) setCtDueOn(saved.ctDueOn);
      if (saved.vatReturns !== undefined) setVatReturns(saved.vatReturns);
      if (saved.ctFiledOn !== undefined) setCtFiledOn(saved.ctFiledOn);
      if (saved.ctStatus !== undefined) setCtStatus(saved.ctStatus);
      if (saved.booksUser !== undefined) setBooksUser(saved.booksUser);
    },
  );

  const vatRegistered = detail.vatState === 'registered';
  const ctRegistered = detail.ctState === 'registered';

  const save = useMutation({
    mutationFn: async () => {
      const text = (value: string) => (value.trim() === '' ? null : value.trim());
      const body: ChangeClientDetails = {
        // The name as on the licence, corrected here when the licence changes.
        ...(legalName.trim() !== '' && legalName.trim() !== detail.legalName
          ? { legalName: legalName.trim() }
          : {}),
        legalNameArabic: text(legalNameArabic),
        tradeLicenceNumber: text(licence),
        contactPerson: text(person),
        contactEmail: text(email),
        mobile: text(mobile),
        landline: text(landline),
        mobile2: text(mobile2),
        weeklyDayOff: dayOff === '' ? null : Number(dayOff),
        address: text(address),
        opensAt: text(opensAt),
        closesAt: text(closesAt),
        references: references.filter((r) => r.label.trim() !== '' && r.value.trim() !== ''),
      };
      // A number is sent only when it was typed or changed. For a client not yet
      // registered it also carries the cycle that gives the deadline a date.
      body.taxLoginMethod = loginMethod === '' ? null : (loginMethod as 'email' | 'uae_pass');
      body.ctReturnDueOn = ctDueOn === '' ? null : ctDueOn;
      body.vatReturns = vatReturns.map((one) => ({
        dueOn: one.dueOn === '' ? null : one.dueOn,
        filedOn: one.filedOn === '' ? null : one.filedOn,
        status: text(one.status),
      }));
      body.ctReturnFiledOn = ctFiledOn === '' ? null : ctFiledOn;
      body.ctReturnStatus = text(ctStatus);
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
      // The months corrected on a client already registered.
      if (
        vatRegistered &&
        periodEnd !== '' &&
        (frequency !== (onFile.length === 12 ? 'monthly' : 'quarterly') ||
          (frequency === 'quarterly' && !onFile.includes(Number(periodEnd))))
      ) {
        body.vatPeriods = { frequency, anchorEndMonth: Number(periodEnd) };
      }
      if (!ctRemark && ctTrn.trim() !== '' && ctTrn.trim() !== (detail.ctTrn ?? '')) {
        body.corporateTax = {
          trn: ctTrn.trim(),
          ...(ctRegistered ? {} : { financialYearEndMonth: Number(yearEnd) }),
        };
      }
      setSentTax(body.corporateTax && !body.vat ? 'ct' : body.vat ? 'vat' : null);
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
          // The program's own user (QuickBooks), not the tax file's login.
          username: text(booksUser) ?? login,
          secret: booksPassword,
        });
      }
      return updated;
    },
    onSuccess: (updated) => {
      draft.discard();
      queries.setQueryData(['clients', detail.id], updated);
      void queries.invalidateQueries({ queryKey: ['clients'] });
      onDone();
    },
  });

  // Months are asked for a client with a VAT number, registered or about to be.
  const hasVat = vatRegistered || (vatTrn.trim() !== '' && !remarkOf(vatTrn));
  // NA: the client has no VAT (or corporation tax), so there are no returns to date.
  const vatIsNa = remarkOf(vatTrn) === 'na';
  const ctIsNa = remarkOf(ctTrn) === 'na';

  const monthOptions = months.map((name, index) => (
    <option key={name} value={String(index + 1)}>
      {name}
    </option>
  ));

  /*
   * The box a refusal is about, marked red under it as well as said at the
   * foot of the form: the firm asked to see which box is the problem rather
   * than read a sentence and hunt for it.
   */
  const failure = save.isError ? (save.error as Error).message : null;
  const errorFor = (box: 'email' | 'mobile' | 'mobile2' | 'landline' | 'vat' | 'ct') => {
    if (failure === null || boxOf(failure, sentTax) !== box) return {};
    return { error: failure };
  };
  return (
    <Card title={t('clients.editDetails')} description={t('clients.passwordsHint')}>
      {draft.restored ? <Alert tone="info">{t('draft.restored')}</Alert> : null}
      <form
        className="u-stack-tight"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const registering =
            !vatRegistered && vatTrn.trim() !== '' && !remarkOf(vatTrn) && periodEnd === '';
          setMissingMonths(registering && frequency === 'quarterly');
          if (registering && frequency === 'quarterly') return;
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
          {...errorFor('email')}
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
        {/* Shown as typed, not as dots: the firm copies these from the
            client's message and needs to see that they went in right. */}
        <Field
          label={t('clients.taxPassword')}
          hint={t('clients.passwordKept')}
          autoComplete="off"
          ltr
          value={taxPassword}
          onChange={(e) => setTaxPassword(e.target.value)}
        />
        <Field
          label={t('clients.booksUser')}
          autoComplete="off"
          ltr
          value={booksUser}
          onChange={(e) => setBooksUser(e.target.value)}
        />
        <Field
          label={t('clients.booksPassword')}
          autoComplete="off"
          ltr
          value={booksPassword}
          onChange={(e) => setBooksPassword(e.target.value)}
        />
        <Field
          label={t('clients.mobile')}
          {...errorFor('mobile')}
          ltr
          inputMode="tel"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
        />
        <Field
          label={t('clients.mobile2')}
          {...errorFor('mobile2')}
          ltr
          inputMode="tel"
          value={mobile2}
          onChange={(e) => setMobile2(e.target.value)}
        />
        <Field
          label={t('clients.landline')}
          {...errorFor('landline')}
          hint={t('clients.landlineHint')}
          ltr
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
          label={t('clients.new.legalName')}
          ltr
          required
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
        />
        <Field
          label={t('clients.new.legalNameArabic')}
          value={legalNameArabic}
          onChange={(e) => setLegalNameArabic(e.target.value)}
        />
        <Field
          label={t('clients.licence')}
          ltr
          value={licence}
          onChange={(e) => setLicence(e.target.value)}
        />
        <Field
          label={t('clients.vatNumber')}
          {...errorFor('vat')}
          hint={t('clients.trnHint')}
          ltr
          value={vatTrn}
          onChange={(e) => setVatTrn(e.target.value)}
        />
        {/*
         * How often and in which months: asked when registering, and open to
         * correction afterwards. Nothing is chosen for the person: a default
         * of March, June… was saved on clients whose quarters end elsewhere.
         */}
        {hasVat ? (
          <div className="u-row">
            <Field
              label={t('clients.vatHowOften')}
              control={(props: ControlProps) => (
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
            {frequency === 'monthly' && !vatRegistered ? (
              <Field
                label={t('clients.periodEnd')}
                control={(props: ControlProps) => (
                  <Select
                    {...props}
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                  >
                    <option value="">{t('clients.chooseMonth')}</option>
                    {monthOptions}
                  </Select>
                )}
              />
            ) : null}
          </div>
        ) : null}
        {/*
         * Four returns a year, so four boxes, one per quarter-end month. They
         * move together: the authority staggers a client's quarters as a set,
         * so choosing any one of the four fixes the other three, and dates the
         * four returns below.
         */}
        {hasVat && frequency === 'quarterly' ? (
          <fieldset className="u-stack-tight">
            <legend>{t('clients.quarterEnds')}</legend>
            <div className="u-row u-wrap">
              {(periodEnd === '' ? [0, 0, 0, 0] : quarterMonths(Number(periodEnd))).map(
                (month, index) => (
                  <Field
                    key={`quarter-${index + 1}`}
                    label={t('clients.quarterEnd', { n: index + 1 })}
                    {...(missingMonths && periodEnd === ''
                      ? { error: t('clients.chooseQuarterMonths') }
                      : {})}
                    control={(props: ControlProps) => (
                      <Select
                        {...props}
                        value={month === 0 ? '' : String(month)}
                        onChange={(e) => chooseQuarterEnd(e.target.value)}
                      >
                        <option value="">{t('clients.chooseMonth')}</option>
                        {monthOptions}
                      </Select>
                    )}
                  />
                ),
              )}
            </div>
            <p className="u-text-faint">{t('clients.quarterEndsHint')}</p>
          </fieldset>
        ) : null}
        {/* The year's four VAT returns. Not asked of a client with no VAT number (NA). */}
        {vatIsNa ? null : (
          <fieldset className="u-stack-tight">
            <legend>{t('clients.vatReturns')}</legend>
            {vatReturns.map((one, index) => (
              <div className="u-row u-row-top u-wrap" key={`vat-return-${index + 1}`}>
                <Field
                  label={t('clients.vatReturnDue', { n: index + 1 })}
                  type="date"
                  value={one.dueOn}
                  onChange={(e) => setVatReturn(index, 'dueOn', e.target.value)}
                />
                <Field
                  label={t('clients.vatReturnFiled', { n: index + 1 })}
                  type="date"
                  value={one.filedOn}
                  onChange={(e) => setVatReturn(index, 'filedOn', e.target.value)}
                />
                <Field
                  label={t('clients.returnStatus')}
                  list="return-statuses"
                  value={one.status}
                  onChange={(e) => setVatReturn(index, 'status', e.target.value)}
                />
              </div>
            ))}
          </fieldset>
        )}
        {/* The words the firm uses, offered; anything else can be typed. */}
        <datalist id="return-statuses">
          {RETURN_STATUSES.map((word) => (
            <option key={word} value={word} />
          ))}
        </datalist>
        <Field
          label={t('clients.ctNumber')}
          {...errorFor('ct')}
          hint={t('clients.trnHint')}
          ltr
          value={ctTrn}
          onChange={(e) => setCtTrn(e.target.value)}
        />
        {!ctRegistered && ctTrn.trim() !== '' && !remarkOf(ctTrn) ? (
          <Field
            label={t('clients.financialYear')}
            control={(props: ControlProps) => (
              <Select {...props} value={yearEnd} onChange={(e) => setYearEnd(e.target.value)}>
                {monthOptions}
              </Select>
            )}
          />
        ) : null}
        {/* Typed from the authority's portal: its due date is the one that counts. */}
        {ctIsNa ? null : (
          <div className="u-row u-row-top u-wrap">
            <Field
              label={t('clients.ctDueOn')}
              type="date"
              value={ctDueOn}
              onChange={(e) => setCtDueOn(e.target.value)}
            />
            <Field
              label={t('clients.ctFiledOn')}
              type="date"
              value={ctFiledOn}
              onChange={(e) => setCtFiledOn(e.target.value)}
            />
            <Field
              label={t('clients.returnStatus')}
              list="return-statuses"
              value={ctStatus}
              onChange={(e) => setCtStatus(e.target.value)}
            />
          </div>
        )}

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
          {/* Cancelling is a decision, so what was typed goes with it. */}
          <Button
            tone="quiet"
            type="button"
            onClick={() => {
              draft.discard();
              onDone();
            }}
          >
            {t('clients.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * What was typed in a tax number box, when it is not a number.
 *
 * Digits (with the spaces and dashes a certificate prints) are a tax number
 * and register the client; anything else is kept as written, so "De-Reg"
 * stands there as the firm wrote it. NA and Rejection keep their old codes.
 */
export function remarkOf(typed: string): string | null {
  const text = typed.trim();
  if (text === '' || /^[\d\s-]+$/.test(text)) return null;
  const value = text.toLowerCase();
  if (value === 'na' || value === 'n/a') return 'na';
  if (value.startsWith('reject') || value.startsWith('regect') || value === 'مرفوض')
    return 'rejected';
  return text.slice(0, 500);
}

/** How a kept note reads back. */
export function remarkText(remark: string | null): string {
  return remark === 'na' ? 'NA' : remark === 'rejected' ? 'Rejection' : (remark ?? '');
}

/**
 * When the returns for these quarter-end months fall due: the 28th of the
 * month after each quarter ends, the next four from today, earliest first.
 */
export function returnDueDates(endMonths: readonly number[], today: Date): string[] {
  const now = today.toISOString().slice(0, 10);
  return endMonths
    .map((end) => {
      const month = (end % 12) + 1;
      let year = today.getUTCFullYear() - 1;
      let due = '';
      do {
        year += 1;
        // A December quarter is due in January of the year after.
        const dueYear = end === 12 ? year + 1 : year;
        due = `${dueYear}-${String(month).padStart(2, '0')}-28`;
      } while (due < now);
      return due;
    })
    .sort();
}

/** The four months a client's VAT quarters end in, from any one of them, in calendar order. */
export function quarterMonths(any: number): number[] {
  return [0, 3, 6, 9].map((step) => ((any - 1 + step) % 12) + 1).sort((a, b) => a - b);
}

/** Which box a refusal from the server is about, by the sentence it sent. */
function boxOf(
  message: string,
  sentTax: 'vat' | 'ct' | null,
): 'email' | 'mobile' | 'mobile2' | 'landline' | 'vat' | 'ct' | null {
  const said = (english: string) => message === english || message === inReadersLanguage(english);
  if (said('Another client already has that VAT number')) return 'vat';
  if (said('Another client already has that corporation tax number')) return 'ct';
  if (said('That is not an email address')) return 'email';
  if (said('The mobile number could not be read as a phone number')) return 'mobile';
  if (said('The landline number could not be read as a phone number')) return 'landline';
  if (said('The second mobile number could not be read as a phone number')) return 'mobile2';
  const aboutTaxNumber = [
    'A tax registration number is digits only',
    'A tax registration number is required',
    'A tax registration number has 15 digits',
  ].some(said);
  return aboutTaxNumber ? sentTax : null;
}
