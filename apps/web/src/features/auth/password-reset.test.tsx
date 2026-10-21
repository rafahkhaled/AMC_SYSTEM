import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setUpI18n } from '../../i18n/index.js';
import { SignInPage } from './sign-in-page.js';

const requestPasswordReset = vi.hoisted(() => vi.fn());
const completePasswordReset = vi.hoisted(() => vi.fn());
vi.mock('./api.js', async () => {
  const actual = await vi.importActual<typeof import('./api.js')>('./api.js');
  return { ...actual, requestPasswordReset, completePasswordReset, signIn: vi.fn() };
});
vi.mock('./session.js', () => ({
  useSession: () => ({
    state: { status: 'signed-out' },
    refresh: vi.fn(),
    needsCode: vi.fn(),
    signOut: vi.fn(),
  }),
}));

async function english() {
  localStorage.setItem('amc.language', 'en');
  await setUpI18n();
}

describe('forgotten passwords on the sign-in screen', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
    await english();
  });

  it('offers "Forgot your password?" under the sign-in button', () => {
    render(<SignInPage />);
    expect(screen.getByRole('button', { name: 'Forgot your password?' })).toBeInTheDocument();
  });

  it('asks for the address, sends it, and says the same thing whoever it was', async () => {
    const user = userEvent.setup();
    requestPasswordReset.mockResolvedValue(undefined);
    render(<SignInPage />);

    await user.click(screen.getByRole('button', { name: 'Forgot your password?' }));
    await user.type(screen.getByLabelText('Email address'), 'wael@activemanagement.ae');
    await user.click(screen.getByRole('button', { name: 'Send the link' }));

    await waitFor(() =>
      expect(requestPasswordReset).toHaveBeenCalledWith('wael@activemanagement.ae'),
    );
    // "If that address is on the system" — it does not confirm that it is.
    expect(await screen.findByText(/If that address is on the system/)).toBeInTheDocument();
  });

  it('will not send an empty request', async () => {
    const user = userEvent.setup();
    render(<SignInPage />);

    await user.click(screen.getByRole('button', { name: 'Forgot your password?' }));
    await user.click(screen.getByRole('button', { name: 'Send the link' }));

    expect(await screen.findByText('Enter your email address')).toBeInTheDocument();
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it('goes back to signing in', async () => {
    const user = userEvent.setup();
    render(<SignInPage />);

    await user.click(screen.getByRole('button', { name: 'Forgot your password?' }));
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('choosing a new password from the emailed link', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/?reset=abc123token456');
    await english();
  });

  it('opens on the new-password screen when the link carries a token', () => {
    render(<SignInPage />);
    expect(screen.getByRole('heading')).toHaveTextContent('Choose a new password');
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('will not send two passwords that differ', async () => {
    const user = userEvent.setup();
    render(<SignInPage />);

    await user.type(screen.getByLabelText('New password'), 'A-Brand-New-Passphrase-42');
    await user.type(screen.getByLabelText('Type it again'), 'Something-else-entirely-1');
    await user.click(screen.getByRole('button', { name: 'Save password' }));

    expect(await screen.findByText('The two passwords are not the same')).toBeInTheDocument();
    expect(completePasswordReset).not.toHaveBeenCalled();
  });

  it('saves it with the token, then takes the link out of the address and says so', async () => {
    const user = userEvent.setup();
    completePasswordReset.mockResolvedValue(undefined);
    render(<SignInPage />);

    await user.type(screen.getByLabelText('New password'), 'A-Brand-New-Passphrase-42');
    await user.type(screen.getByLabelText('Type it again'), 'A-Brand-New-Passphrase-42');
    await user.click(screen.getByRole('button', { name: 'Save password' }));

    await waitFor(() =>
      expect(completePasswordReset).toHaveBeenCalledWith(
        'abc123token456',
        'A-Brand-New-Passphrase-42',
      ),
    );
    expect(await screen.findByText(/Your password has been changed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    // A used link must not stay in the address bar, history or a screenshot.
    expect(window.location.search).toBe('');
  });

  it('shows what the server said when the link is no good or the password is too easy', async () => {
    const user = userEvent.setup();
    completePasswordReset.mockRejectedValue(
      new Error('This link has expired or has already been used'),
    );
    render(<SignInPage />);

    await user.type(screen.getByLabelText('New password'), 'A-Brand-New-Passphrase-42');
    await user.type(screen.getByLabelText('Type it again'), 'A-Brand-New-Passphrase-42');
    await user.click(screen.getByRole('button', { name: 'Save password' }));

    expect(
      await screen.findByText('This link has expired or has already been used'),
    ).toBeInTheDocument();
    // Stays on the form so they can try another, or ask for a new link.
    expect(screen.getByRole('button', { name: 'Save password' })).toBeInTheDocument();
  });
});
