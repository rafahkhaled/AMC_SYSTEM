import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { NewClient } from './new-client.js';

const onboardClient = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ onboardClient }));

beforeEach(async () => {
  vi.clearAllMocks();
  await useLanguage('en');
});

describe('adding a client directly', () => {
  it('adds one with only its name, and opens it', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    onboardClient.mockResolvedValue({ id: 'c-new' });
    renderScreen(<NewClient onCreated={onCreated} />);

    await user.click(screen.getByRole('button', { name: 'New client' }));
    await user.type(
      screen.getByLabelText('Legal name (in English, as on the licence)'),
      'Gulf Trading LLC',
    );
    await user.type(screen.getByLabelText('Name in Arabic'), 'الخليج للتجارة');
    await user.click(screen.getByRole('button', { name: 'Add the client' }));

    await waitFor(() =>
      expect(onboardClient).toHaveBeenCalledWith({
        legalName: 'Gulf Trading LLC',
        legalNameArabic: 'الخليج للتجارة',
      }),
    );
    expect(onCreated).toHaveBeenCalledWith('c-new');
  });

  it('marks the name when it is left empty, instead of sending nothing', async () => {
    const user = userEvent.setup();
    renderScreen(<NewClient onCreated={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'New client' }));
    await user.click(screen.getByRole('button', { name: 'Add the client' }));

    expect(onboardClient).not.toHaveBeenCalled();
    expect(screen.getByText('This field is required')).toBeInTheDocument();
  });

  it('shows the server’s refusal', async () => {
    const user = userEvent.setup();
    onboardClient.mockRejectedValue(new Error('A client needs a legal name'));
    renderScreen(<NewClient onCreated={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'New client' }));
    await user.type(screen.getByLabelText('Legal name (in English, as on the licence)'), 'X');
    await user.click(screen.getByRole('button', { name: 'Add the client' }));

    expect(await screen.findByText('A client needs a legal name')).toBeInTheDocument();
  });
});
