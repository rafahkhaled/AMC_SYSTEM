import type { LetterTemplateDetail } from '@amc/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { LetterTemplatesPanel } from './templates-panel.js';

const letterTemplateDetails = vi.hoisted(() => vi.fn());
const addLetterTemplate = vi.hoisted(() => vi.fn());
const changeLetterTemplate = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ letterTemplateDetails, addLetterTemplate, changeLetterTemplate }));

const template = (over: Partial<LetterTemplateDetail> = {}): LetterTemplateDetail => ({
  code: 'engagement_letter',
  nameEn: 'Engagement letter',
  nameAr: 'خطاب التكليف',
  bodyEn: 'Dear {{client_name}}',
  bodyAr: 'السادة {{client_name}}',
  needs: ['client_name'],
  retired: false,
  ...over,
});

beforeEach(async () => {
  vi.clearAllMocks();
  await useLanguage('en');
  letterTemplateDetails.mockResolvedValue([template()]);
});

describe('the firm’s letters (feedback item 6)', () => {
  it('lists them with how many facts each needs', async () => {
    renderScreen(<LetterTemplatesPanel />);
    expect(await screen.findByText('Engagement letter')).toBeInTheDocument();
  });

  it('adds a letter, in both languages, using the facts the system can fill in', async () => {
    addLetterTemplate.mockResolvedValue(template());
    renderScreen(<LetterTemplatesPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Add a letter' }));
    await userEvent.type(screen.getByLabelText('Name in English'), 'Salary certificate request');
    await userEvent.type(screen.getByLabelText('Name in Arabic'), 'طلب شهادة راتب');
    await userEvent.type(screen.getByLabelText('Wording in English'), 'To ');
    await userEvent.click(screen.getByRole('button', { name: 'Client name' }));
    await userEvent.type(screen.getByLabelText('Wording in Arabic'), 'إلى ');
    await userEvent.click(screen.getByRole('button', { name: 'Client name' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save the letter' }));

    await waitFor(() =>
      expect(addLetterTemplate).toHaveBeenCalledWith({
        nameEn: 'Salary certificate request',
        nameAr: 'طلب شهادة راتب',
        bodyEn: 'To {{client_name}}',
        bodyAr: 'إلى {{client_name}}',
      }),
    );
  });

  it('puts a fact where the cursor is, in the wording being edited', async () => {
    renderScreen(<LetterTemplatesPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add a letter' }));

    const english = screen.getByLabelText('Wording in English') as HTMLTextAreaElement;
    await userEvent.type(english, 'Dear , regards');
    // Put the cursor after "Dear ".
    english.setSelectionRange(5, 5);
    await userEvent.click(screen.getByRole('button', { name: 'Client name' }));

    expect(english.value).toBe('Dear {{client_name}}, regards');
  });

  it('flags a fact the system cannot fill in, and will not save with it', async () => {
    renderScreen(<LetterTemplatesPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add a letter' }));
    await userEvent.type(screen.getByLabelText('Name in English'), 'X');
    await userEvent.type(screen.getByLabelText('Name in Arabic'), 'س');
    await userEvent.type(screen.getByLabelText('Wording in English'), 'Dear {{{{client_nme}}');
    await userEvent.type(screen.getByLabelText('Wording in Arabic'), 'مرحباً');

    // A typo that would otherwise reach a client with the braces still in it.
    expect(screen.getByText(/cannot fill in: \{\{client_nme\}\}/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save the letter' })).toBeDisabled();
  });

  it('will not save with the wording missing in either language', async () => {
    renderScreen(<LetterTemplatesPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add a letter' }));
    await userEvent.type(screen.getByLabelText('Name in English'), 'X');
    await userEvent.type(screen.getByLabelText('Name in Arabic'), 'س');
    await userEvent.type(screen.getByLabelText('Wording in English'), 'Only English');

    expect(screen.getByRole('button', { name: 'Save the letter' })).toBeDisabled();
  });

  it('edits one of the letters the firm started with, from what it already says', async () => {
    changeLetterTemplate.mockResolvedValue(template());
    renderScreen(<LetterTemplatesPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Wording in English')).toHaveValue('Dear {{client_name}}');

    await userEvent.type(screen.getByLabelText('Wording in English'), ' and partners');
    await userEvent.click(screen.getByRole('button', { name: 'Save the letter' }));

    await waitFor(() =>
      expect(changeLetterTemplate).toHaveBeenCalledWith(
        'engagement_letter',
        expect.objectContaining({ bodyEn: 'Dear {{client_name}} and partners' }),
      ),
    );
  });

  it('retires one rather than deleting it', async () => {
    changeLetterTemplate.mockResolvedValue(template({ retired: true }));
    renderScreen(<LetterTemplatesPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Retire' }));
    await waitFor(() =>
      expect(changeLetterTemplate).toHaveBeenCalledWith('engagement_letter', { retired: true }),
    );
  });

  it('shows the server’s refusal in its own words', async () => {
    addLetterTemplate.mockRejectedValue(new Error('Name the letter in both English and Arabic'));
    renderScreen(<LetterTemplatesPanel />);

    await userEvent.click(await screen.findByRole('button', { name: 'Add a letter' }));
    await userEvent.type(screen.getByLabelText('Name in English'), 'X');
    await userEvent.type(screen.getByLabelText('Name in Arabic'), 'س');
    await userEvent.type(screen.getByLabelText('Wording in English'), 'x');
    await userEvent.type(screen.getByLabelText('Wording in Arabic'), 'س');
    await userEvent.click(screen.getByRole('button', { name: 'Save the letter' }));

    expect(await screen.findByText(/Name the letter in both/)).toBeInTheDocument();
  });
});
