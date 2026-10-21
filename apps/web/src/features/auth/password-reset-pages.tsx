import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Field } from '../../design/index.js';
import { completePasswordReset, requestPasswordReset } from './api.js';

/** Asks for the address and says a link is on its way, whoever typed it. */
export function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError(t('signIn.emailRequired'));
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch {
      setError(t('signIn.unavailable'));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="u-stack">
        {/* Said the same for every address: this does not confirm one exists. */}
        <Alert tone="success">{t('reset.sent')}</Alert>
        <Button tone="quiet" block onClick={onBack}>
          {t('reset.backToSignIn')}
        </Button>
      </div>
    );
  }

  return (
    <form className="u-stack" onSubmit={submit} noValidate>
      <p className="u-text-soft">{t('reset.forgotHint')}</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        label={t('signIn.email')}
        type="email"
        name="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        ltr
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={busy}
      />
      <Button type="submit" block busy={busy}>
        {t('reset.sendLink')}
      </Button>
      <Button type="button" tone="quiet" block onClick={onBack}>
        {t('reset.backToSignIn')}
      </Button>
    </form>
  );
}

/** Choosing the new password, from the link in the email. */
export function ResetPasswordForm({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!password) {
      setError(t('signIn.passwordRequired'));
      return;
    }
    if (password !== again) {
      setError(t('reset.mismatch'));
      return;
    }
    setBusy(true);
    try {
      await completePasswordReset(token, password);
      onDone();
    } catch (failure) {
      // What the server says here is something the person can act on: this link
      // has expired, or that password is too easy to guess.
      setError(failure instanceof Error ? failure.message : t('signIn.unavailable'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="u-stack" onSubmit={submit} noValidate>
      <p className="u-text-soft">{t('reset.chooseHint')}</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field
        label={t('reset.newPassword')}
        type={show ? 'text' : 'password'}
        name="new-password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={busy}
        hint={t('reset.rules')}
      />
      <Field
        label={t('reset.again')}
        type={show ? 'text' : 'password'}
        name="confirm-password"
        autoComplete="new-password"
        value={again}
        onChange={(event) => setAgain(event.target.value)}
        disabled={busy}
      />
      <label className="u-row u-row--tight">
        <input type="checkbox" checked={show} onChange={() => setShow(!show)} />
        {t('signIn.showPassword')}
      </label>
      <Button type="submit" block busy={busy}>
        {t('reset.save')}
      </Button>
    </form>
  );
}
