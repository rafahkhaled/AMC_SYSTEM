import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Field, Select } from '../../design/index.js';
import { listSalespeople } from '../classification/api.js';
import { listClients } from '../clients/api.js';
import { useServices } from '../services/use-services.js';
import { assignProject, startProject, unassignProject } from './api.js';

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
 *
 * Who does the work is chosen here, on the job, not on the client: one client
 * is worked on by several people, each on their own service. Left empty, the
 * job goes to whoever did this client's last job of the same service.
 */
export function StartProjectForm({ onStarted }: { onStarted: (id: string) => void }) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState('');
  const [service, setService] = useState<string>('deregistration');
  const [dueOn, setDueOn] = useState('');
  const [performer, setPerformer] = useState('');
  const services = useServices();

  const clients = useQuery({ queryKey: ['clients'], queryFn: listClients, enabled: open });
  const people = useQuery({
    queryKey: ['salespeople'],
    queryFn: listSalespeople,
    staleTime: 60_000,
    enabled: open,
  });
  // Who can do the work: the firm's own people, with an account.
  const employees = (people.data ?? []).filter((person) => person.userId && !person.retired);

  const start = useMutation({
    mutationFn: async () => {
      const project = await startProject({ clientId, service, ...(dueOn ? { dueOn } : {}) });
      if (performer) {
        const before = project.assignees.find((person) => person.role === 'responsible');
        if (before?.userId !== performer) {
          await assignProject(project.id, performer, 'responsible');
          // The one picked from the last job made way: off this one entirely.
          if (before) await unassignProject(project.id, before.userId);
        }
      }
      return project;
    },
    onSuccess: (project) => {
      void queries.invalidateQueries({ queryKey: ['projects'] });
      setOpen(false);
      setClientId('');
      setDueOn('');
      setPerformer('');
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
            <Select
              {...props}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            >
              <option value="">{t('projects.start.chooseClient')}</option>
              {(clients.data ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.legalName}
                </option>
              ))}
            </Select>
          )}
        />

        <Field
          label={t('projects.start.service')}
          control={(props) => (
            <Select {...props} value={service} onChange={(event) => setService(event.target.value)}>
              {services.live.map((offered) => (
                <option key={offered.code} value={offered.code}>
                  {t(`services.${offered.code}`)}
                </option>
              ))}
            </Select>
          )}
        />

        <Field
          label={t('classification.performedBy')}
          hint={t('projects.start.performerHint')}
          control={(props) => (
            <Select
              {...props}
              value={performer}
              onChange={(event) => setPerformer(event.target.value)}
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
