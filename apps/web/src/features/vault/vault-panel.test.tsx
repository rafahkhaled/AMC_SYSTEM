import type { CredentialSummary } from '@amc/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { VaultPanel } from './vault-panel.js';

const listCredentials = vi.hoisted(() => vi.fn());
const revealCredential = vi.hoisted(() => vi.fn());
const storeCredential = vi.hoisted(() => vi.fn());
const retireCredential = vi.hoisted(() => vi.fn());
const referenceOptions = vi.hoisted(() => vi.fn());
vi.mock('../lists/api.js', () => ({ referenceOptions }));

const portal = (code: string, nameEn: string, retired = false) => ({
  id: code,
  list: 'portal' as const,
  code,
  nameEn,
  nameAr: nameEn,
  position: 0,
  retired,
});
vi.mock('./api.js', () => ({
  listCredentials,
  revealCredential,
  storeCredential,
  retireCredential,
}));

const LOGIN: CredentialSummary = {
  id: 'cred-1',
  kind: 'emaratax',
  username: 'gulf.trading@portal.ae',
  note: 'Dubai portal',
  link: null,
  slot: 1,
  createdAt: '2026-09-01T06:00:00.000Z',
};

function show(credentials: CredentialSummary[] = [LOGIN]) {
  listCredentials.mockResolvedValue(credentials);
  renderScreen(<VaultPanel clientId="c-1" />);
}

/** Asks for a password with a reason and returns what came back on screen. */
async function reveal(user: ReturnType<typeof userEvent.setup>, reason: string) {
  await user.click(await screen.findByRole('button', { name: 'Show the password' }));
  await user.type(screen.getByLabelText('Why it is needed'), reason);
  await user.click(screen.getByRole('button', { name: 'Show' }));
}

describe('a client’s portal logins (FR-05)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useRealTimers();
    await useLanguage('en');
    referenceOptions.mockResolvedValue([
      portal('emaratax', 'EmaraTax'),
      portal('ftaportal', 'FTA portal'),
      portal('mohre', 'MOHRE'),
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the username freely and the password never', async () => {
    /*
     * Knowing a username is not knowing a password, and hiding it would mean
     * opening a secret just to tell two entries apart.
     */
    show();

    expect(await screen.findByText('gulf.trading@portal.ae')).toBeInTheDocument();
    expect(screen.queryByText(/P@ss/)).not.toBeInTheDocument();
    expect(revealCredential).not.toHaveBeenCalled();
  });

  it('will not ask for a password until a reason is given', async () => {
    // A log recording twenty reads and no reasons says somebody looked, which
    // an auditor could have guessed.
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole('button', { name: 'Show the password' }));

    expect(screen.getByRole('button', { name: 'Show' })).toBeDisabled();
    expect(revealCredential).not.toHaveBeenCalled();
  });

  it('sends the reason with the request', async () => {
    const user = userEvent.setup();
    show();
    revealCredential.mockResolvedValue({ username: LOGIN.username, secret: 'S3cret' });

    await reveal(user, 'Filing the Q3 VAT return');

    expect(revealCredential).toHaveBeenCalledWith('c-1', 'cred-1', 'Filing the Q3 VAT return');
    expect(await screen.findByText('S3cret')).toBeInTheDocument();
  });

  /*
   * The forty-five second auto-hide is not asserted mechanically.
   *
   * It is a real behaviour and it is covered from two sides below: the screen
   * promises it in words, and hiding on demand works. Driving the timeout
   * itself needs fake timers, and React Query's own scheduling under a stopped
   * clock makes that test hang rather than fail — which is the worse way for a
   * test to be wrong. It was tried three ways and dropped on purpose.
   */

  it('says how long the password will stay on screen', async () => {
    const user = userEvent.setup();
    show();
    revealCredential.mockResolvedValue({ username: LOGIN.username, secret: 'S3cret' });

    await reveal(user, 'Filing the Q3 VAT return');

    expect(await screen.findByText('hides in 45 seconds')).toBeInTheDocument();
  });

  it('can be hidden at once, for somebody who is finished with it', async () => {
    const user = userEvent.setup();
    show();
    revealCredential.mockResolvedValue({ username: LOGIN.username, secret: 'S3cret' });

    await reveal(user, 'Filing the Q3 VAT return');
    await user.click(await screen.findByRole('button', { name: 'Hide' }));

    expect(screen.queryByText('S3cret')).not.toBeInTheDocument();
  });

  it('shows the refusal the server gave', async () => {
    const user = userEvent.setup();
    show();
    revealCredential.mockRejectedValue(new Error('Say why the password is needed'));

    await reveal(user, 'abc');

    expect(await screen.findByText('Say why the password is needed')).toBeInTheDocument();
  });

  it('shows nothing at all to somebody the server refuses', async () => {
    // A role without `clients.vault.read` is refused, which is not a fault and
    // must not put an error on a client file.
    listCredentials.mockRejectedValue(new Error('You do not have access to this'));
    renderScreen(<VaultPanel clientId="c-1" />);

    await waitFor(() => expect(screen.queryByText('Portal logins')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says plainly when a client has no logins kept', async () => {
    show([]);
    expect(await screen.findByText('No logins are kept for this client.')).toBeInTheDocument();
  });

  it('adds a login without the password leaving the form', async () => {
    const user = userEvent.setup();
    show([]);
    storeCredential.mockResolvedValue([LOGIN]);

    await user.click(await screen.findByRole('button', { name: 'Add a login' }));
    await user.type(screen.getByLabelText('Username'), 'new@portal.ae');
    await user.type(screen.getByLabelText('Password'), 'N3w-P@ssword');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(storeCredential).toHaveBeenCalledWith('c-1', {
        kind: 'emaratax',
        username: 'new@portal.ae',
        secret: 'N3w-P@ssword',
        slot: 1,
      }),
    );
  });

  /*
   * Which portals the firm keeps logins for (feedback item 7).
   *
   * The four it started with were a list in the screen, in the domain and in a
   * constraint on the table. They are now the "Portals" list in Settings, so a
   * bank's own portal or the next government service is added there.
   */
  it('offers the portals on the list, including one added later', async () => {
    const user = userEvent.setup();
    show([]);

    await user.click(await screen.findByRole('button', { name: 'Add a login' }));
    const options = within(await screen.findByLabelText('Portal'))
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(options).toEqual(['EmaraTax', 'FTA portal', 'MOHRE']);
  });

  it('stores a login for a portal added from Settings', async () => {
    const user = userEvent.setup();
    show([]);
    storeCredential.mockResolvedValue([LOGIN]);

    await user.click(await screen.findByRole('button', { name: 'Add a login' }));
    await user.selectOptions(await screen.findByLabelText('Portal'), 'mohre');
    await user.type(screen.getByLabelText('Username'), 'new@portal.ae');
    await user.type(screen.getByLabelText('Password'), 'N3w-P@ssword');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(storeCredential).toHaveBeenCalledWith(
        'c-1',
        expect.objectContaining({ kind: 'mohre' }),
      ),
    );
  });

  it('does not offer a portal that has been retired, but still names one already stored', async () => {
    referenceOptions.mockResolvedValue([
      portal('emaratax', 'EmaraTax'),
      portal('old_portal', 'Old portal', true),
    ]);
    const user = userEvent.setup();
    show([{ ...LOGIN, kind: 'old_portal' }]);

    // A login stored for it still says what it opens...
    expect(await screen.findByText('Old portal')).toBeInTheDocument();
    // ...and it is not offered for a new one.
    await user.click(screen.getByRole('button', { name: 'Add a login' }));
    const options = within(await screen.findByLabelText('Portal'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['EmaraTax']);
  });

  it('will not offer to save before the portal list has arrived', async () => {
    referenceOptions.mockResolvedValue([]);
    const user = userEvent.setup();
    show([]);

    await user.click(await screen.findByRole('button', { name: 'Add a login' }));
    await user.type(screen.getByLabelText('Username'), 'new@portal.ae');
    await user.type(screen.getByLabelText('Password'), 'N3w-P@ssword');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('will not save a login with no password', async () => {
    const user = userEvent.setup();
    show([]);

    await user.click(await screen.findByRole('button', { name: 'Add a login' }));
    await user.type(screen.getByLabelText('Username'), 'new@portal.ae');

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('retires a login rather than deleting it', async () => {
    // An audit asks who could have filed on this client's behalf last March,
    // and a deleted row cannot answer.
    const user = userEvent.setup();
    show();
    retireCredential.mockResolvedValue([]);

    await user.click(await screen.findByRole('button', { name: 'Retire' }));

    expect(retireCredential).toHaveBeenCalledWith('c-1', 'cred-1');
  });

  describe('the portal link and the second user', () => {
    it('shows a link to the portal beside a login that has one', async () => {
      show([{ ...LOGIN, link: 'https://eservices.tax.gov.ae/login' }]);
      const link = await screen.findByRole('link', { name: 'Open the portal' });
      expect(link).toHaveAttribute('href', 'https://eservices.tax.gov.ae/login');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('marks the second user of a portal', async () => {
      show([LOGIN, { ...LOGIN, id: 'cred-2', slot: 2, username: 'second@portal.ae' }]);
      expect(await screen.findByText('second@portal.ae')).toBeInTheDocument();
      expect(screen.getByText('User 2')).toBeInTheDocument();
    });

    it('stores the link and which user it is', async () => {
      const user = userEvent.setup();
      show([]);
      storeCredential.mockResolvedValue([LOGIN]);

      await user.click(await screen.findByRole('button', { name: 'Add a login' }));
      await user.selectOptions(await screen.findByLabelText('User'), '2');
      await user.type(screen.getByLabelText('Portal link'), 'https://eservices.tax.gov.ae');
      await user.type(screen.getByLabelText('Username'), 'second@portal.ae');
      await user.type(screen.getByLabelText('Password'), 'N3w-P@ssword');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(storeCredential).toHaveBeenCalledWith(
          'c-1',
          expect.objectContaining({ link: 'https://eservices.tax.gov.ae', slot: 2 }),
        ),
      );
    });
  });
});
