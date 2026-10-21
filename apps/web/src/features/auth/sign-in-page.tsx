import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../../components/language-switch.js';
import { Alert, Button, Card, Field } from '../../design/index.js';
import { ApiError, signIn } from './api.js';
import { ForgotPasswordForm, ResetPasswordForm } from './password-reset-pages.js';
import { useSession } from './session.js';

/** The reset token in the address, when somebody arrived from the emailed link. */
function tokenInAddress(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('reset');
  } catch {
    return null;
  }
}

export function SignInPage() {
  const { t } = useTranslation();
  const [token, setToken] = useState<string | null>(tokenInAddress);
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin');
  const [changed, setChanged] = useState(false);
  const { refresh, needsCode } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    // Field-level for something the person can fix by looking at the form.
    const problems: { email?: string; password?: string } = {};
    if (!email.trim()) problems.email = t('signIn.emailRequired');
    if (!password) problems.password = t('signIn.passwordRequired');
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setBusy(true);
    try {
      const result = await signIn({ email: email.trim(), password });
      if (result.twoFactorRequired) needsCode();
      else await refresh();
    } catch (failure) {
      // The server says the same thing for a wrong password and an unknown
      // address, and so does this. Being more helpful would undo that.
      setError(failure instanceof ApiError ? t('signIn.failed') : t('signIn.unavailable'));
    } finally {
      setBusy(false);
    }
  };

  /** Back to the sign-in form, with the link taken out of the address bar. */
  const backToSignIn = (afterReset: boolean) => {
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch {
      // The address bar is cosmetic; carry on.
    }
    setToken(null);
    setMode('signin');
    setChanged(afterReset);
  };

  if (token !== null || mode === 'forgot') {
    return (
      <main className="u-centre">
        <div style={{ inlineSize: 'min(26rem, 100%)' }}>
          <Card floating>
            <div className="u-row u-spread" style={{ marginBlockEnd: 'var(--space-4)' }}>
              <h1>{token !== null ? t('reset.chooseTitle') : t('reset.forgotTitle')}</h1>
              <LanguageSwitch />
            </div>
            {token !== null ? (
              <ResetPasswordForm token={token} onDone={() => backToSignIn(true)} />
            ) : (
              <ForgotPasswordForm onBack={() => backToSignIn(false)} />
            )}
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="u-centre">
      <form onSubmit={submit} noValidate style={{ inlineSize: 'min(26rem, 100%)' }}>
        <Card floating>
          <div className="u-row u-spread" style={{ marginBlockEnd: 'var(--space-4)' }}>
            <div className="u-stack-tight">
              <h1>{t('signIn.title')}</h1>
              <p className="u-text-soft">{t('signIn.subtitle')}</p>
            </div>
            <LanguageSwitch />
          </div>

          <div className="u-stack">
            {changed ? <Alert tone="success">{t('reset.done')}</Alert> : null}
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
              error={fieldErrors.email}
              disabled={busy}
            />

            <Field
              label={t('signIn.password')}
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={fieldErrors.password}
              disabled={busy}
              affix={
                <Button
                  tone="quiet"
                  small
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? t('signIn.hidePassword') : t('signIn.showPassword')}
                  aria-pressed={showPassword}
                  tabIndex={-1}
                >
                  {showPassword ? '◡' : '◠'}
                </Button>
              }
            />

            <Button type="submit" block busy={busy}>
              {busy ? t('signIn.submitting') : t('signIn.submit')}
            </Button>
            <Button type="button" tone="quiet" block onClick={() => setMode('forgot')}>
              {t('reset.forgot')}
            </Button>
          </div>
        </Card>
      </form>
    </main>
  );
}
