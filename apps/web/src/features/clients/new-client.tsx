import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Field } from '../../design/index.js';
import { onboardClient } from './api.js';

/**
 * Adding a client directly.
 *
 * For a client the firm already has, who never came in as an enquiry. Only the
 * name is needed to start; the tax numbers, contact and documents are added on
 * the client's page straight after, which is where this opens.
 */
export function NewClient({ onCreated }: { onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const [open, setOpen] = useState(false);
  const [legalName, setLegalName] = useState('');
  const [legalNameArabic, setLegalNameArabic] = useState('');
  const [licence, setLicence] = useState('');
  const [tried, setTried] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      onboardClient({
        legalName: legalName.trim(),
        ...(legalNameArabic.trim() ? { legalNameArabic: legalNameArabic.trim() } : {}),
        ...(licence.trim() ? { tradeLicenceNumber: licence.trim() } : {}),
      }),
    onSuccess: (client) => {
      void queries.invalidateQueries({ queryKey: ['clients'] });
      onCreated(client.id);
    },
  });

  if (!open) {
    return (
      <div className="u-row">
        <Button onClick={() => setOpen(true)}>{t('clients.new.open')}</Button>
      </div>
    );
  }

  return (
    <Card title={t('clients.new.title')} description={t('clients.new.hint')}>
      <form
        className="u-stack-tight"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (legalName.trim() !== '') create.mutate();
        }}
      >
        <Field
          label={t('clients.new.legalName')}
          ltr
          required
          value={legalName}
          onChange={(event) => setLegalName(event.target.value)}
          {...(tried && legalName.trim() === '' ? { error: t('form.required') } : {})}
        />
        <Field
          label={t('clients.new.legalNameArabic')}
          value={legalNameArabic}
          onChange={(event) => setLegalNameArabic(event.target.value)}
        />
        <Field
          label={t('clients.licence')}
          ltr
          value={licence}
          onChange={(event) => setLicence(event.target.value)}
        />
        {create.isError ? <Alert tone="error">{(create.error as Error).message}</Alert> : null}
        <div className="u-row">
          <Button type="submit" busy={create.isPending}>
            {t('clients.new.save')}
          </Button>
          <Button type="button" tone="quiet" onClick={() => setOpen(false)}>
            {t('clients.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
