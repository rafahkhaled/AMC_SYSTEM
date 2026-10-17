import type { CredentialSummary } from '@amc/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Field, Select } from '../../design/index.js';
import { useOptions } from '../lists/use-options.js';
import { listCredentials, retireCredential, revealCredential, storeCredential } from './api.js';

/** How long a revealed password stays on screen before it hides itself again. */
const VISIBLE_SECONDS = 45;

/**
 * The client's logins to the portals the practice files through (FR-05).
 *
 * Usernames are shown freely: knowing one is not knowing a password, and
 * hiding them would mean opening a secret just to tell two entries apart.
 * Passwords are never in the list at all — they arrive only when asked for,
 * one at a time, with a reason that goes into the audit log.
 */
export function VaultPanel({ clientId }: { clientId: string }) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const key = ['credentials', clientId];

  const credentials = useQuery({ queryKey: key, queryFn: () => listCredentials(clientId) });
  const settle = (next: CredentialSummary[]) => queries.setQueryData(key, next);

  const retire = useMutation({
    mutationFn: (id: string) => retireCredential(clientId, id),
    onSuccess: settle,
  });

  if (credentials.isError) {
    // A role without `clients.vault.read` is refused, which is not a fault.
    return null;
  }

  return (
    <Card title={t('vault.title')} description={t('vault.hint')}>
      {(credentials.data ?? []).length === 0 ? (
        <p className="u-text-faint">{t('vault.none')}</p>
      ) : (
        <div className="u-stack-tight">
          {(credentials.data ?? []).map((credential) => (
            <CredentialRow
              key={credential.id}
              clientId={clientId}
              credential={credential}
              onRetire={() => retire.mutate(credential.id)}
              retiring={retire.isPending}
            />
          ))}
        </div>
      )}

      <StoreCredential clientId={clientId} onStored={settle} />
    </Card>
  );
}

function CredentialRow({
  clientId,
  credential,
  onRetire,
  retiring,
}: {
  clientId: string;
  credential: CredentialSummary;
  onRetire: () => void;
  retiring: boolean;
}) {
  const { t } = useTranslation();
  // Named from the list an administrator maintains, retired portals included:
  // a login stored for one still has to say what it opens.
  const portals = useOptions('portal');
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [secret, setSecret] = useState<string | null>(null);

  const reveal = useMutation({
    mutationFn: () => revealCredential(clientId, credential.id, reason.trim()),
    onSuccess: (revealed) => {
      setSecret(revealed.secret);
      setAsking(false);
      setReason('');
    },
  });

  /*
   * It hides itself again after a while. A password left on a screen is a
   * password over somebody's shoulder, and the person who revealed it has
   * already copied it or has not.
   */
  useEffect(() => {
    if (secret === null) return;
    const timer = setTimeout(() => setSecret(null), VISIBLE_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [secret]);

  return (
    <div className="u-stack-tight credential">
      <div className="line">
        <Badge>{portals.label(credential.kind)}</Badge>
        {credential.slot === 2 ? <Badge tone="accent">{t('vault.userTwo')}</Badge> : null}
        <span className="u-ltr">{credential.username}</span>
        {credential.note ? <span className="u-text-faint">{credential.note}</span> : null}
        {credential.link ? (
          <a href={credential.link} target="_blank" rel="noopener noreferrer" className="u-ltr">
            {t('vault.openPortal')}
          </a>
        ) : null}
        <span className="u-grow" />
        {secret === null ? (
          <Button small tone="secondary" onClick={() => setAsking(!asking)}>
            {t('vault.reveal')}
          </Button>
        ) : null}
        <Button small tone="quiet" busy={retiring} onClick={onRetire}>
          {t('vault.retire')}
        </Button>
      </div>

      {asking ? (
        <form
          className="u-row u-row-top credential__ask"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim().length >= 3) reveal.mutate();
          }}
        >
          <Field
            label={t('vault.why')}
            hint={t('vault.whyHint')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button type="submit" small disabled={reason.trim().length < 3} busy={reveal.isPending}>
            {t('vault.show')}
          </Button>
          <Button type="button" small tone="quiet" onClick={() => setAsking(false)}>
            {t('documents.clear')}
          </Button>
        </form>
      ) : null}

      {reveal.error ? <Alert tone="error">{reveal.error.message}</Alert> : null}

      {secret !== null ? (
        <div className="line credential__secret">
          <code className="u-ltr">{secret}</code>
          <span className="u-grow" />
          <span className="u-text-faint">
            {t('vault.hidesShortly', { seconds: VISIBLE_SECONDS })}
          </span>
          <Button small tone="quiet" onClick={() => setSecret(null)}>
            {t('vault.hide')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StoreCredential({
  clientId,
  onStored,
}: {
  clientId: string;
  onStored: (credentials: CredentialSummary[]) => void;
}) {
  const { t } = useTranslation();
  const portals = useOptions('portal');
  const [open, setOpen] = useState(false);
  // Empty until the list arrives, then the first one on it. A hardcoded default
  // would offer a portal an administrator has since retired.
  const [kind, setKind] = useState<string>('');
  const chosen = kind || portals.live[0]?.code || '';
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');
  const [slot, setSlot] = useState<'1' | '2'>('1');

  const store = useMutation({
    mutationFn: () =>
      storeCredential(clientId, {
        kind: chosen,
        username: username.trim(),
        secret,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(link.trim() ? { link: link.trim() } : {}),
        slot: slot === '2' ? 2 : 1,
      }),
    onSuccess: (credentials) => {
      onStored(credentials);
      setOpen(false);
      setUsername('');
      setSecret('');
      setNote('');
      setLink('');
      setSlot('1');
    },
  });

  if (!open) {
    return (
      <Button small tone="secondary" onClick={() => setOpen(true)}>
        {t('vault.add')}
      </Button>
    );
  }

  const ready = chosen !== '' && username.trim().length > 0 && secret.length > 0;

  return (
    <form
      className="u-stack credential__form"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) store.mutate();
      }}
    >
      <Field
        label={t('vault.portal')}
        control={(props) => (
          <Select {...props} value={chosen} onChange={(event) => setKind(event.target.value)}>
            {portals.live.map((option) => (
              <option key={option.code} value={option.code}>
                {portals.label(option.code)}
              </option>
            ))}
          </Select>
        )}
      />
      <Field
        label={t('vault.user')}
        control={(props) => (
          <Select
            {...props}
            value={slot}
            onChange={(event) => setSlot(event.target.value as '1' | '2')}
          >
            <option value="1">{t('vault.userOne')}</option>
            <option value="2">{t('vault.userTwo')}</option>
          </Select>
        )}
      />
      <Field
        label={t('vault.link')}
        hint={t('vault.linkHint')}
        ltr
        inputMode="url"
        value={link}
        onChange={(event) => setLink(event.target.value)}
      />
      <Field
        label={t('vault.username')}
        ltr
        value={username}
        onChange={(event) => setUsername(event.target.value)}
      />
      <Field
        label={t('vault.password')}
        hint={t('vault.passwordHint')}
        type="password"
        ltr
        autoComplete="new-password"
        value={secret}
        onChange={(event) => setSecret(event.target.value)}
      />
      <Field
        label={t('vault.note')}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />

      {store.error ? <Alert tone="error">{store.error.message}</Alert> : null}

      <div className="u-row">
        <Button type="submit" disabled={!ready} busy={store.isPending}>
          {t('vault.save')}
        </Button>
        <Button type="button" tone="quiet" onClick={() => setOpen(false)}>
          {t('documents.clear')}
        </Button>
      </div>
    </form>
  );
}
