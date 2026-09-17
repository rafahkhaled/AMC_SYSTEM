import type { ClientSummary } from '@amc/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Card, Empty, Field, Loading } from '../../design/index.js';
import { LeadsBoard } from '../leads/leads-board.js';
import { listClients } from './api.js';

/**
 * What the client list can be narrowed to.
 *
 * Both of these are "show me the problem", which is the only reason to filter
 * a list of forty companies. Filtering happens in the browser because the
 * whole list is already here — a round trip per keystroke would be slower and
 * would tell the server what somebody is typing.
 */
type Filter = 'all' | 'documents' | 'work';

/**
 * The client list.
 *
 * Two columns earn their place beyond the name: how many documents need
 * attention and how much work is open. A list that only names things makes
 * somebody open every row to find out where the problem is.
 */
export function ClientsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'clients' | 'leads'>('clients');

  return (
    <div className="u-stack">
      <div className="u-row tabs">
        {(['clients', 'leads'] as const).map((which) => (
          <button
            key={which}
            type="button"
            className={`tab${tab === which ? ' tab--active' : ''}`}
            aria-current={tab === which ? 'page' : undefined}
            onClick={() => setTab(which)}
          >
            {t(`clients.tabs.${which}`)}
          </button>
        ))}
      </div>

      {tab === 'clients' ? <ClientList onOpen={onOpen} /> : <LeadsBoard onOpenClient={onOpen} />}
    </div>
  );
}

function ClientList({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const clients = useQuery({ queryKey: ['clients'], queryFn: listClients });

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (clients.data ?? []).filter((client) => {
      // Matched against both names and the tax number, because people search
      // for whichever of the three is in front of them.
      const matches =
        needle === '' ||
        client.legalName.toLowerCase().includes(needle) ||
        (client.legalNameArabic ?? '').toLowerCase().includes(needle) ||
        (client.vatTrn ?? '').includes(needle);

      if (!matches) return false;
      if (filter === 'documents') return client.documentsExpiring > 0;
      if (filter === 'work') return client.openTasks > 0;
      return true;
    });
  }, [clients.data, search, filter]);

  if (clients.isLoading) return <Loading label={t('loading')} />;
  if (clients.isError) return <p className="alert alert--error">{t('clients.failed')}</p>;
  if (!clients.data?.length) return <Empty title={t('clients.none')} />;

  return (
    <Card title={t('clients.title')} description={t('clients.subtitle')}>
      <div className="u-row u-row-top">
        <Field
          label={t('clients.search')}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Field
          label={t('clients.showing')}
          control={(props) => (
            <select
              {...props}
              className="input"
              value={filter}
              onChange={(event) => setFilter(event.target.value as Filter)}
            >
              <option value="all">{t('clients.filters.all')}</option>
              <option value="documents">{t('clients.filters.documents')}</option>
              <option value="work">{t('clients.filters.work')}</option>
            </select>
          )}
        />
      </div>

      {shown.length === 0 ? (
        <Empty title={t('clients.noneMatch')} description={t('clients.noneMatchHint')} />
      ) : null}

      <div className="table-scroll" hidden={shown.length === 0}>
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
            {shown.map((client) => (
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
