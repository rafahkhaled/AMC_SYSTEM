import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, verifyTwoFactor } from './api.js';
import { useSession } from './session.js';

export function TwoFactorPage() {
  const { t } = useTranslation();
  const { refresh, signOut } = useSession();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyTwoFactor(code);
      await refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? t('twoFactor.failed') : t('signIn.unavailable'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="centred">
      <form className="card stack" onSubmit={submit} noValidate>
        <div className="stack-tight">
          <h1>{t('twoFactor.title')}</h1>
          <p className="muted">{t('twoFactor.subtitle')}</p>
        </div>

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}

        <label>
          {t('twoFactor.code')}
          <input
            // A one-time code, so the keyboard should be numeric and the
            // browser should offer the code it may have received.
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={busy}
          />
        </label>

        <button type="submit" disabled={busy || code.trim().length < 6}>
          {t('twoFactor.submit')}
        </button>

        {/* A half-finished sign-in must have a way out that is not waiting. */}
        <button type="button" className="quiet" onClick={() => void signOut()}>
          {t('home.signOut')}
        </button>
      </form>
    </main>
  );
}
