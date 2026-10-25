import type { ClassifiedEntity, UpdateClassification } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Field, Select } from '../../design/index.js';
import { useBranches } from '../branches/use-branches.js';
import { addSalesperson, changeClassification, classificationOf, listSalespeople } from './api.js';

/** The value in the salesperson box that opens "add a name". */
const ADD = '__add__';

/**
 * Branch, salesperson and who did the work, on one record.
 *
 * The same three boxes on the client, the enquiry, the quotation, the job and
 * the invoice, so the firm can sort everything by them. Each record starts
 * with the values of the one before it; changing them here changes only this
 * record. Saved as soon as something is chosen.
 */
export function ClassificationPanel({
  entity,
  id,
  canEdit,
}: {
  entity: ClassifiedEntity;
  id: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const key = ['classification', entity, id];
  const current = useQuery({ queryKey: key, queryFn: () => classificationOf(entity, id) });

  const save = useMutation({
    mutationFn: (changes: UpdateClassification) => changeClassification(entity, id, changes),
    onSuccess: (next) => queries.setQueryData(key, next),
  });

  if (!current.data) return null;
  const value = current.data;

  return (
    <Card title={t('classification.title')} description={t('classification.hint')}>
      <ClassificationFields
        branchCode={value.branchEditable ? value.branchCode : undefined}
        salespersonId={value.salespersonId}
        performedBy={value.performerEditable ? value.performedBy : undefined}
        disabled={!canEdit || save.isPending}
        onChange={(changes) => save.mutate(changes)}
      />
      {save.isError ? <Alert tone="error">{(save.error as Error).message}</Alert> : null}
    </Card>
  );
}

/**
 * The three boxes on their own, for a form that is still being filled in (a
 * new client, a new enquiry). A field passed as `undefined` is not shown.
 */
export function ClassificationFields({
  branchCode,
  salespersonId,
  performedBy,
  disabled = false,
  onChange,
}: {
  branchCode?: string | null | undefined;
  salespersonId: string | null;
  performedBy?: string | null | undefined;
  disabled?: boolean;
  onChange: (changes: UpdateClassification) => void;
}) {
  const { t, i18n } = useTranslation();
  const queries = useQueryClient();
  const branches = useBranches();
  const people = useQuery({
    queryKey: ['salespeople'],
    queryFn: listSalespeople,
    staleTime: 60_000,
  });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const add = useMutation({
    mutationFn: () => addSalesperson(name.trim()),
    onSuccess: (result) => {
      queries.setQueryData(['salespeople'], result.salespeople);
      setAdding(false);
      setName('');
      onChange({ salespersonId: result.id });
    },
  });

  const everyone = people.data ?? [];
  const salespeople = everyone.filter((person) => !person.retired || person.id === salespersonId);
  // Who did the work is an employee: a salesperson with an account.
  const employees = everyone.filter(
    (person) => person.userId !== null && (!person.retired || person.userId === performedBy),
  );
  const arabic = i18n.language === 'ar';

  return (
    <div className="u-stack-tight">
      <div className="u-row u-row-top u-wrap">
        {branchCode !== undefined ? (
          <Field
            label={t('classification.branch')}
            control={(props) => (
              <Select
                {...props}
                value={branchCode ?? ''}
                disabled={disabled}
                onChange={(event) => onChange({ branchCode: event.target.value || null })}
              >
                <option value="">{t('classification.none')}</option>
                {branches.live.map((branch) => (
                  <option key={branch.code} value={branch.code}>
                    {arabic ? branch.nameAr : branch.nameEn}
                  </option>
                ))}
              </Select>
            )}
          />
        ) : null}

        <Field
          label={t('classification.salesperson')}
          control={(props) => (
            <Select
              {...props}
              value={salespersonId ?? ''}
              disabled={disabled}
              onChange={(event) => {
                if (event.target.value === ADD) {
                  setAdding(true);
                  return;
                }
                onChange({ salespersonId: event.target.value || null });
              }}
            >
              <option value="">{t('classification.none')}</option>
              {salespeople.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
              <option value={ADD}>{t('classification.addSalesperson')}</option>
            </Select>
          )}
        />

        {performedBy !== undefined ? (
          <Field
            label={t('classification.performedBy')}
            control={(props) => (
              <Select
                {...props}
                value={performedBy ?? ''}
                disabled={disabled}
                onChange={(event) => onChange({ performedBy: event.target.value || null })}
              >
                <option value="">{t('classification.none')}</option>
                {employees.map((person) => (
                  <option key={person.id} value={person.userId ?? ''}>
                    {person.name}
                  </option>
                ))}
              </Select>
            )}
          />
        ) : null}
      </div>

      {adding ? (
        <div className="u-row u-row-top">
          <Field
            label={t('classification.newSalesperson')}
            hint={t('classification.newSalespersonHint')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            type="button"
            small
            disabled={name.trim() === ''}
            busy={add.isPending}
            onClick={() => add.mutate()}
          >
            {t('classification.add')}
          </Button>
          <Button type="button" small tone="quiet" onClick={() => setAdding(false)}>
            {t('clients.cancel')}
          </Button>
        </div>
      ) : null}
      {add.isError ? <Alert tone="error">{(add.error as Error).message}</Alert> : null}
    </div>
  );
}
