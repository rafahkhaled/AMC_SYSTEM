import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../../components/language-switch.js';
import { ApiError, signIn } from './api.js';
import { useSession } from './session.js';

export function SignInPage() {
  const { t } = useTranslation();
  const { refresh, needsCode } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return setError(t('signIn.emailRequired'));
    if (!password) return setError(t('signIn.passwordRequired'));

    setBusy(true);
    setError(null);
    try {
      const result = await signIn({ email: email.trim(), password });
      // A second factor means the session exists but is not yet usable for
      // anything except presenting the code.
      if (result.twoFactorRequired) needsCode();
      else await refresh();
    } catch (failure) {
      // The server says the same thing for a wrong password and an unknown
      // address, and so does this. Being more helpful here would undo that.
      setError(failure instanceof ApiError ? t('signIn.failed') : t('signIn.unavailable'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="centred">
      <form className="card stack" onSubmit={submit} noValidate>
        <div className="row spread">
          <div className="stack-tight">
            <h1>{t('signIn.title')}</h1>
            <p className="muted">{t('signIn.subtitle')}</p>
          </div>
          <LanguageSwitch />
        </div>

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}

        <label>
          {t('signIn.email')}
          <input
            type="email"
            name="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
          />
        </label>

        <label>
          {t('signIn.password')}
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
          />
        </label>

        <button type="submit" disabled={busy}>
          {busy ? t('signIn.submitting') : t('signIn.submit')}
        </button>
      </form>
    </main>
  );
}
