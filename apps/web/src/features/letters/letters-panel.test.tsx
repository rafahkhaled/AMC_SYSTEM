import type { Letter, LetterTemplate } from '@amc/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { LettersPanel } from './letters-panel.js';

const letterTemplates = vi.hoisted(() => vi.fn());
const lettersFor = vi.hoisted(() => vi.fn());
const generateLetter = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ letterTemplates, lettersFor, generateLetter }));

const TEMPLATE: LetterTemplate = {
  code: 'engagement_letter',
  nameEn: 'Engagement letter',
  nameAr: 'خطاب التكليف',
  needs: ['client_name', 'trade_licence'],
};

function letter(over: Partial<Letter> = {}): Letter {
  return {
    id: 'letter-1',
    title: 'Engagement letter',
    body: 'To: Gulf Trading LLC\nTrade licence: CN-1234567\n\nDear Sirs,',
    language: 'en',
    createdAt: '2026-09-17T06:00:00.000Z',
    missing: [],
    ...over,
  };
}

function show(history: Letter[] = []) {
  letterTemplates.mockResolvedValue([TEMPLATE]);
  lettersFor.mockResolvedValue(history);
  renderScreen(<LettersPanel clientId="c-1" />);
}

/** Chooses a letter and a language, then generates it. */
async function generate(user: ReturnType<typeof userEvent.setup>, language = 'en') {
  // Wait for the option, not the select: the select is on screen before the
  // templates have arrived, and selecting then finds only "Choose a letter".
  await screen.findByRole('option', { name: 'Engagement letter' });
  await user.selectOptions(screen.getByLabelText('Letter'), 'engagement_letter');
  await user.selectOptions(screen.getByLabelText('Language'), language);
  await user.click(screen.getByRole('button', { name: 'Generate' }));
}

describe('the firm’s letters (FR-15)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await useLanguage('en');
  });

  it('will not generate until a letter has been chosen', async () => {
    show();
    expect(await screen.findByRole('button', { name: 'Generate' })).toBeDisabled();
  });

  it('fills the letter in from the client record', async () => {
    const user = userEvent.setup();
    show();
    generateLetter.mockResolvedValue(letter());

    await generate(user);

    expect(generateLetter).toHaveBeenCalledWith('c-1', 'engagement_letter', 'en');
    expect(await screen.findByText(/Gulf Trading LLC/)).toBeInTheDocument();
  });

  it('says what the client record could not supply', async () => {
    /*
     * Not a refusal. A letter with a gap is often exactly what somebody wants,
     * because the number is about to be written in by hand, and refusing would
     * send them back to a Word file.
     */
    const user = userEvent.setup();
    show();
    generateLetter.mockResolvedValue(letter({ missing: ['trade_licence', 'vat_trn'] }));

    await generate(user);

    expect(
      await screen.findByText(/Not on the client.s record: trade licence, VAT number/),
    ).toBeInTheDocument();
    // Still produced, gaps and all.
    expect(screen.getByText(/Dear Sirs/)).toBeInTheDocument();
  });

  it('says nothing about gaps when there are none', async () => {
    const user = userEvent.setup();
    show();
    generateLetter.mockResolvedValue(letter());

    await generate(user);

    await screen.findByText(/Dear Sirs/);
    expect(screen.queryByText(/Not on the client/)).not.toBeInTheDocument();
  });

  it('renders the body as text, never as markup', async () => {
    /*
     * The server escapes what it fills in, and this renders the result rather
     * than setting it as HTML. A company called `Smith & Sons <Trading>` is
     * unusual; one with an ampersand is not.
     */
    const user = userEvent.setup();
    show();
    generateLetter.mockResolvedValue(letter({ body: 'To: Smith &amp; Sons &lt;Trading&gt;' }));

    await generate(user);

    const body = await screen.findByText(/Smith/);
    expect(body.textContent).toBe('To: Smith &amp; Sons &lt;Trading&gt;');
    expect(body.querySelector('script')).toBeNull();
  });

  it('turns an Arabic letter round to read right to left', async () => {
    const user = userEvent.setup();
    show();
    generateLetter.mockResolvedValue(
      letter({ language: 'ar', title: 'خطاب التكليف', body: 'إلى: الخليج للتجارة' }),
    );

    await generate(user, 'ar');

    const article = document.querySelector('.letter');
    expect(article).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('خطاب التكليف')).toBeInTheDocument();
  });

  it('offers to print only once there is something to print', async () => {
    const user = userEvent.setup();
    show();
    generateLetter.mockResolvedValue(letter());

    expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
    await generate(user);
    expect(await screen.findByRole('button', { name: 'Print' })).toBeInTheDocument();
  });

  it('lists what was produced before, so a letter can be found again', async () => {
    // What was produced is stored rather than regenerated: a letter is a thing
    // that was sent.
    show([letter({ id: 'old-1', title: 'VAT deregistration request' })]);

    expect(await screen.findByText('Produced before')).toBeInTheDocument();
    expect(screen.getByText('VAT deregistration request')).toBeInTheDocument();
  });

  it('opens one that was produced before', async () => {
    const user = userEvent.setup();
    show([letter({ id: 'old-1', body: 'The letter as it went out.' })]);

    await user.click(await screen.findByRole('button', { name: 'Open' }));

    expect(screen.getByText('The letter as it went out.')).toBeInTheDocument();
  });

  it('shows the refusal the server gave', async () => {
    const user = userEvent.setup();
    show();
    generateLetter.mockRejectedValue(new Error('No such letter'));

    await generate(user);

    expect(await screen.findByText('No such letter')).toBeInTheDocument();
  });
});
