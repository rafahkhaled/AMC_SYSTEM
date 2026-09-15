import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setUpI18n } from '../../i18n/index.js';
import { ApiError } from './api.js';
import { SignInPage } from './sign-in-page.js';

const signIn = vi.hoisted(() => vi.fn());
vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js');
  return { ...actual, signIn };
});

const refresh = vi.fn();
const needsCode = vi.fn();
vi.mock('./session.js', () => ({
  useSession: () => ({ state: { status: 'signed-out' }, refresh, needsCode, signOut: vi.fn() }),
}));

describe('the sign-in screen', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    await setUpI18n();
  });

  it('renders in Arabic, right to left, by default', async () => {
    render(<SignInPage />);
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('heading')).toHaveTextContent('تسجيل الدخول');
  });

  it('names the field that is missing, and marks it invalid for a screen reader', async () => {
    const user = userEvent.setup();
    render(<SignInPage />);

    await user.click(screen.getByRole('button', { name: 'دخول' }));

    expect(await screen.findByText('أدخل البريد الإلكتروني')).toBeInTheDocument();
    // Attached to the input, so assistive technology says which one is wrong
    // rather than only that something is.
    expect(screen.getByLabelText('البريد الإلكتروني')).toHaveAttribute('aria-invalid', 'true');
    expect(signIn).not.toHaveBeenCalled();
  });

  it('signs in and refreshes the session', async () => {
    signIn.mockResolvedValue({
      caller: { userId: 'u1', displayName: 'Wael', roles: ['manager'], permissions: [] },
      expiresAt: new Date().toISOString(),
      twoFactorRequired: false,
    });

    const user = userEvent.setup();
    render(<SignInPage />);
    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'wael@activemanagement.ae');
    await user.type(screen.getByLabelText('كلمة المرور'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(signIn).toHaveBeenCalledWith({
      email: 'wael@activemanagement.ae',
      password: 'correct horse battery staple',
    });
  });

  it('goes to the code step instead of the application when a second factor is due', async () => {
    signIn.mockResolvedValue({
      caller: { userId: 'u1', displayName: 'Wael', roles: ['manager'], permissions: [] },
      expiresAt: new Date().toISOString(),
      twoFactorRequired: true,
    });

    const user = userEvent.setup();
    render(<SignInPage />);
    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'wael@activemanagement.ae');
    await user.type(screen.getByLabelText('كلمة المرور'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    await waitFor(() => expect(needsCode).toHaveBeenCalled());
    expect(refresh).not.toHaveBeenCalled();
  });

  it('repeats the server wording exactly, and adds nothing of its own', async () => {
    // The server answers a wrong password and an unknown address identically.
    // Being more helpful here would give back what that was protecting.
    signIn.mockRejectedValue(new ApiError(401, 'HTTP_ERROR', 'Those details are not right'));

    const user = userEvent.setup();
    render(<SignInPage />);
    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'nobody@nowhere.ae');
    await user.type(screen.getByLabelText('كلمة المرور'), 'whatever12345');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('البيانات غير صحيحة');
  });

  it('says the server is unreachable when it is, which is a different problem', async () => {
    signIn.mockRejectedValue(new TypeError('Failed to fetch'));

    const user = userEvent.setup();
    render(<SignInPage />);
    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'wael@activemanagement.ae');
    await user.type(screen.getByLabelText('كلمة المرور'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'دخول' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('تعذّر الاتصال بالخادم');
  });
});
