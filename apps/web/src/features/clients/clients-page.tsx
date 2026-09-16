import type { ClientSummary } from '@amc/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Badge, Card, Empty, Loading } from '../../design/index.js';
import { listClients } from './api.js';

/**
 * The client list.
 *
 * Two columns earn their place beyond the name: how many documents need
 * attention and how much work is open. A list that only names things makes
 * somebody open every row to find out where the problem is.
 */
export function ClientsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const clients = useQuery({ queryKey: ['clients'], queryFn: listClients });

  if (clients.isLoading) return <Loading label={t('loading')} />;
  if (clients.isError) return <p className="alert alert--error">{t('clients.failed')}</p>;
  if (!clients.data?.length) return <Empty title={t('clients.none')} />;

  return (
    <Card title={t('clients.title')} description={t('clients.subtitle')}>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{t('clients.name')}</th>
              <th>{t('clients.vat')}</th>
              <th>{t('clients.documents')}</th>
              <th>{t('clients.openWork')}</th>
            </tr>
          </thead>
          <tbody>
            {clients.data.map((client) => (
              <ClientRow key={client.id} client={client} onOpen={onOpen} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ClientRow({
  client,
  onOpen,
}: {
  client: ClientSummary;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <tr>
      <td>
        <button type="button" className="link-button" onClick={() => onOpen(client.id)}>
          {client.legalNameArabic ?? client.legalName}
        </button>
        {client.legalNameArabic ? (
          <div className="u-text-faint u-ltr">{client.legalName}</div>
        ) : null}
      </td>
      <td>
        {client.vatState === 'registered' ? (
          <span className="u-ltr u-mono u-text-soft">{client.vatTrn}</span>
        ) : (
          <span className="u-text-faint">{t(`registration.${client.vatState}`)}</span>
        )}
      </td>
      <td>
        {client.documentsExpiring > 0 ? (
          <Badge tone="warning">
            {t('clients.needsAttention', { count: client.documentsExpiring })}
          </Badge>
        ) : (
          <span className="u-text-faint">—</span>
        )}
      </td>
      <td className="u-numeric">{client.openTasks > 0 ? client.openTasks : '—'}</td>
    </tr>
  );
}
