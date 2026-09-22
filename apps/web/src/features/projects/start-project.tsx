import { serviceCodes } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Field } from '../../design/index.js';
import { listClients } from '../clients/api.js';
import { startProject } from './api.js';

/**
 * Opening a piece of work by hand (FR-10, FR-11).
 *
 * The recurring services — VAT returns, CT returns, monthly accounting —
 * arrive on their own from the recurrence sweep. The one-off ones do not, and
 * had no way in at all: a client would ring asking for a de-registration and
 * there was nothing to open.
 *
 * Client and service and nothing else required. A due date is offered because
 * the caller often knows one, and left empty otherwise rather than guessed —
 * a made-up deadline on a screen that exists to show real deadlines is worse
 * than no deadline.
 */
export function StartProjectForm({ onStarted }: { onStarted: (id: string) => void }) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState('');
  const [service, setService] = useState<string>('deregistration');
  const [dueOn, setDueOn] = useState('');

  const clients = useQuery({ queryKey: ['clients'], queryFn: listClients, enabled: open });

  const start = useMutation({
    mutationFn: () => startProject({ clientId, service, ...(dueOn ? { dueOn } : {}) }),
    onSuccess: (project) => {
      void queries.invalidateQueries({ queryKey: ['projects'] });
      setOpen(false);
      setClientId('');
      setDueOn('');
      onStarted(project.id);
    },
  });

  if (!open) {
    return (
      <div className="u-row">
        <Button onClick={() => setOpen(true)}>{t('projects.start.open')}</Button>
      </div>
    );
  }

  return (
    <Card title={t('projects.start.title')} description={t('projects.start.hint')}>
      <form
        className="u-stack-tight"
        onSubmit={(event) => {
          event.preventDefault();
          if (clientId) start.mutate();
        }}
      >
        <Field
          label={t('projects.start.client')}
          control={(props) => (
            <select
              {...props}
              className="input"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            >
              <option value="">{t('projects.start.chooseClient')}</option>
              {(clients.data ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.legalName}
                </option>
              ))}
            </select>
          )}
        />

        <Field
          label={t('projects.start.service')}
          control={(props) => (
            <select
              {...props}
              className="input"
              value={service}
              onChange={(event) => setService(event.target.value)}
            >
              {serviceCodes.map((code) => (
                <option key={code} value={code}>
                  {t(`services.${code}`)}
                </option>
              ))}
            </select>
          )}
        />

        <Field
          label={t('projects.start.dueOn')}
          hint={t('projects.start.dueOnHint')}
          type="date"
          value={dueOn}
          onChange={(event) => setDueOn(event.target.value)}
        />

        {/* The server's words, not a rewrite: it refuses a second open
            project for the same service and names which one, and that is
            exactly what the person needs to read. */}
        {start.isError ? <Alert tone="error">{(start.error as Error).message}</Alert> : null}

        <div className="u-row">
          <Button type="submit" busy={start.isPending} disabled={!clientId}>
            {t('projects.start.submit')}
          </Button>
          <Button tone="quiet" onClick={() => setOpen(false)}>
            {t('projects.start.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
