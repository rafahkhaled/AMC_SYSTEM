import { type ReferenceList, referenceLists } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Field, Loading, Select } from '../../design/index.js';
import { addOption, referenceOptions, updateOption } from './api.js';

/**
 * The lists an administrator maintains (FR-03).
 *
 * Document types, issuing authorities, how a payment arrived: things a
 * practice learns rather than things a developer decides. Each was a constant
 * in the source, so a new free-zone authority meant a deploy.
 *
 * Not every dropdown is here, and that is deliberate. Project states drive a
 * state machine, roles decide permissions, and services carry a task template
 * and a deadline rule — a new row in any of those would be a name with no
 * behaviour behind it, which is worse than refusing to add one.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const [list, setList] = useState<ReferenceList>('document_type');

  return (
    <div className="u-stack">
      <div className="u-stack-tight">
        <h1>{t('settings.title')}</h1>
        <p className="u-text-soft">{t('settings.hint')}</p>
      </div>

      <Card title={t('settings.whichList')}>
        <Field
          label={t('settings.list')}
          control={(props) => (
            <Select
              {...props}
              value={list}
              onChange={(event) => setList(event.target.value as ReferenceList)}
            >
              {referenceLists.map((name) => (
                <option key={name} value={name}>
                  {t(`settings.lists.${name}`)}
                </option>
              ))}
            </Select>
          )}
        />
      </Card>

      <OptionList list={list} />
    </div>
  );
}

function OptionList({ list }: { list: ReferenceList }) {
  const { t, i18n } = useTranslation();
  const queries = useQueryClient();
  const arabic = i18n.language === 'ar';

  const options = useQuery({
    queryKey: ['lists', list],
    queryFn: () => referenceOptions(list),
  });

  const retire = useMutation({
    mutationFn: ({ code, retired }: { code: string; retired: boolean }) =>
      updateOption(list, code, { retired }),
    onSuccess: (next) => queries.setQueryData(['lists', list], next),
  });

  if (options.isLoading) return <Loading label={t('loading')} />;

  return (
    <>
      <AddOption list={list} />

      <Card title={t(`settings.lists.${list}`)} description={t('settings.listHint')}>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('settings.name')}</th>
                <th scope="col">{t('settings.code')}</th>
                <th scope="col">{t('settings.manage')}</th>
              </tr>
            </thead>
            <tbody>
              {(options.data ?? []).map((option) => (
                <tr key={option.code}>
                  <th scope="row" className="u-typed">
                    {arabic ? option.nameAr : option.nameEn}
                    <span className="u-block u-text-faint u-typed">
                      {arabic ? option.nameEn : option.nameAr}
                    </span>
                    {option.retired ? (
                      <span className="u-block">
                        <Badge tone="neutral">{t('settings.retired')}</Badge>
                      </span>
                    ) : null}
                  </th>
                  <td>
                    <span className="u-ltr u-mono u-text-faint">{option.code}</span>
                  </td>
                  <td>
                    {/*
                     * Retire, never delete. Anything already filed under this
                     * code has to keep reading correctly — the same bargain
                     * suspending an employee makes.
                     */}
                    <Button
                      small
                      tone="quiet"
                      busy={retire.isPending}
                      onClick={() => retire.mutate({ code: option.code, retired: !option.retired })}
                    >
                      {option.retired ? t('settings.restore') : t('settings.retire')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function AddOption({ list }: { list: ReferenceList }) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const [open, setOpen] = useState(false);
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [code, setCode] = useState('');

  const add = useMutation({
    mutationFn: () => addOption(list, { code: code.trim(), nameEn, nameAr }),
    onSuccess: (next) => {
      queries.setQueryData(['lists', list], next);
      setOpen(false);
      setNameEn('');
      setNameAr('');
      setCode('');
    },
  });

  /*
   * The code is suggested from the English name, and editable.
   *
   * It is what every row using this option stores, so it never changes
   * afterwards — which makes it worth seeing before it is written rather
   * than generating one silently.
   */
  const suggest = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40);

  if (!open) {
    return (
      <div className="u-row">
        <Button onClick={() => setOpen(true)}>{t('settings.add.open')}</Button>
      </div>
    );
  }

  return (
    <Card title={t('settings.add.title')} description={t('settings.add.hint')}>
      <form
        className="u-stack-tight"
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate();
        }}
      >
        <Field
          label={t('settings.add.nameEn')}
          ltr
          value={nameEn}
          onChange={(event) => {
            setNameEn(event.target.value);
            if (code === '' || code === suggest(nameEn)) setCode(suggest(event.target.value));
          }}
        />
        <Field
          label={t('settings.add.nameAr')}
          value={nameAr}
          onChange={(event) => setNameAr(event.target.value)}
        />
        <Field
          label={t('settings.add.code')}
          hint={t('settings.add.codeHint')}
          ltr
          value={code}
          onChange={(event) => setCode(suggest(event.target.value))}
        />

        {add.isError ? <Alert tone="error">{(add.error as Error).message}</Alert> : null}

        <div className="u-row">
          <Button type="submit" busy={add.isPending} disabled={!nameEn || !nameAr || !code}>
            {t('settings.add.submit')}
          </Button>
          <Button tone="quiet" onClick={() => setOpen(false)}>
            {t('settings.add.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
