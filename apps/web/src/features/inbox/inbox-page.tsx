import type { Inbox, NotificationView } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Empty, Loading } from '../../design/index.js';
import { choosePreference, inbox, markAllRead, markRead, preferences } from './api.js';

/**
 * What somebody has been told (FR-43).
 *
 * Their own, always. There is no permission involved — everybody has an inbox
 * and nobody has anybody else's — so the caller's own id is the whole of the
 * authorisation, applied in the query rather than checked afterwards.
 */
export function InboxPage() {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const [tab, setTab] = useState<'inbox' | 'settings'>('inbox');
  const messages = useQuery({ queryKey: ['inbox'], queryFn: () => inbox() });

  const settle = (next: Inbox) => queries.setQueryData(['inbox'], next);
  const read = useMutation({ mutationFn: markRead, onSuccess: settle });
  const readAll = useMutation({ mutationFn: markAllRead, onSuccess: settle });

  return (
    <div className="u-stack">
      <div className="u-row tabs">
        {(['inbox', 'settings'] as const).map((which) => (
          <button
            key={which}
            type="button"
            className={`tab${tab === which ? ' tab--active' : ''}`}
            aria-current={tab === which ? 'page' : undefined}
            onClick={() => setTab(which)}
          >
            {t(`inbox.tabs.${which}`)}
          </button>
        ))}
      </div>

      {tab === 'settings' ? <Settings /> : null}

      {tab === 'inbox' ? (
        <Card title={t('inbox.title')} description={t('inbox.hint')}>
          {messages.isLoading ? <Loading label={t('loading')} /> : null}
          {messages.isError ? <p className="alert alert--error">{t('inbox.failed')}</p> : null}

          {messages.data && messages.data.entries.length === 0 ? (
            <Empty title={t('inbox.none')} description={t('inbox.noneHint')} />
          ) : null}

          {messages.data && messages.data.unread > 0 ? (
            <div className="u-row">
              <Button small tone="quiet" busy={readAll.isPending} onClick={() => readAll.mutate()}>
                {t('inbox.readAll', { count: messages.data.unread })}
              </Button>
            </div>
          ) : null}

          <div className="u-stack-tight">
            {(messages.data?.entries ?? []).map((entry) => (
              <Message
                key={entry.id}
                entry={entry}
                onRead={() => read.mutate(entry.id)}
                reading={read.isPending}
              />
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Message({
  entry,
  onRead,
  reading,
}: {
  entry: NotificationView;
  onRead: () => void;
  reading: boolean;
}) {
  const { t, i18n } = useTranslation();
  const arabic = i18n.language === 'ar';

  const when = new Intl.DateTimeFormat(arabic ? 'ar-AE' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  }).format(new Date(entry.createdAt));

  return (
    <div className={`message${entry.readAt ? '' : ' message--unread'}`}>
      <div className="line">
        <Badge tone={entry.readAt ? 'neutral' : 'accent'}>
          {t(`inbox.kinds.${entry.kind}`, { defaultValue: entry.kind })}
        </Badge>
        <strong>{arabic ? entry.titleAr : entry.titleEn}</strong>
        <span className="u-grow" />
        <span className="u-text-faint">{when}</span>
        {entry.readAt ? null : (
          <Button small tone="quiet" busy={reading} onClick={onRead}>
            {t('inbox.markRead')}
          </Button>
        )}
      </div>
      <p className="message__body">{arabic ? entry.bodyAr : entry.bodyEn}</p>
    </div>
  );
}

/**
 * What each person wants to hear about, and how.
 *
 * Every kind is listed, whether or not it has been changed. A screen showing
 * only what somebody has already touched is one where the rest are invisible.
 */
function Settings() {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const chosen = useQuery({ queryKey: ['notification-preferences'], queryFn: preferences });

  const choose = useMutation({
    mutationFn: choosePreference,
    onSuccess: (next) => queries.setQueryData(['notification-preferences'], next),
  });

  if (chosen.isLoading) return <Loading label={t('loading')} />;

  return (
    <Card title={t('inbox.settings')} description={t('inbox.settingsHint')}>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{t('inbox.about')}</th>
              <th>{t('inbox.inApp')}</th>
              <th>{t('inbox.byEmail')}</th>
            </tr>
          </thead>
          <tbody>
            {(chosen.data ?? []).map((preference) => (
              <tr key={preference.kind}>
                <td>{t(`inbox.kinds.${preference.kind}`)}</td>
                <td>
                  <Toggle
                    label={t('inbox.inApp')}
                    checked={preference.inApp}
                    onChange={(inApp) => choose.mutate({ ...preference, inApp })}
                  />
                </td>
                <td>
                  <Toggle
                    label={t('inbox.byEmail')}
                    checked={preference.email}
                    onChange={(email) => choose.mutate({ ...preference, email })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="u-row checkbox">
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

/** The number on the menu. Polled, because notifications arrive on their own. */
export function useUnreadCount(): number {
  const messages = useQuery({
    queryKey: ['inbox'],
    queryFn: () => inbox(),
    // A minute is often enough for something that is not urgent by the time
    // it reaches an inbox, and rare enough not to be a background nuisance.
    refetchInterval: 60_000,
  });
  return messages.data?.unread ?? 0;
}
