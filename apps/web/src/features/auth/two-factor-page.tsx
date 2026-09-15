import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Field } from '../../design/index.js';
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
    <main className="u-centre">
      <form onSubmit={submit} noValidate style={{ inlineSize: 'min(26rem, 100%)' }}>
        <Card floating title={t('twoFactor.title')} description={t('twoFactor.subtitle')}>
          <div className="u-stack">
            {error ? <Alert tone="error">{error}</Alert> : null}

            <Field
              label={t('twoFactor.code')}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              ltr
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={busy}
              hint={t('twoFactor.hint')}
            />

            <Button type="submit" block busy={busy} disabled={code.trim().length < 6}>
              {t('twoFactor.submit')}
            </Button>

            {/* A half-finished sign-in needs a way out that is not waiting. */}
            <Button tone="quiet" block onClick={() => void signOut()}>
              {t('home.signOut')}
            </Button>
          </div>
        </Card>
      </form>
    </main>
  );
}
