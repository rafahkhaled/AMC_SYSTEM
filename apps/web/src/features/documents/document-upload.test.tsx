import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setUpI18n } from '../../i18n/index.js';
import { DocumentUpload } from './document-upload.js';

const uploadDocument = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ uploadDocument, documentLink: vi.fn() }));

/*
 * The types come from the list an administrator maintains, so the form now
 * reads them rather than holding a constant. Stubbed here with the rows the
 * migration seeds, which is what a real screen sees.
 */
const referenceOptions = vi.hoisted(() => vi.fn());
vi.mock('../lists/api.js', () => ({
  referenceOptions,
  addOption: vi.fn(),
  updateOption: vi.fn(),
}));

const option = (list: string, code: string, nameEn: string, position: number) => ({
  id: `ro-${code}`,
  list: list as 'document_type' | 'authority',
  code,
  nameEn,
  nameAr: nameEn,
  position,
  retired: false,
});

beforeEach(() => {
  // Per list, because the form reads two of them and a shared stub puts the
  // same "Other" in both dropdowns.
  referenceOptions.mockImplementation(async (list: string) =>
    list === 'authority'
      ? [
          option('authority', 'ded', 'DED', 10),
          option('authority', 'free_zone', 'Free zone authority', 50),
        ]
      : [
          option('document_type', 'trade_licence', 'Trade licence', 10),
          option('document_type', 'bank_letter', 'Bank letter', 90),
          option('document_type', 'other', 'Other', 999),
        ],
  );
});

function show(onUploaded = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<DocumentUpload clientId="c-1" onUploaded={onUploaded} />, { wrapper: Wrapper });
  return onUploaded;
}

const pdf = () =>
  new File([new Uint8Array([37, 80, 68, 70])], 'licence.pdf', {
    type: 'application/pdf',
  });

/** The hidden input behind the drop area, which is the keyboard route in. */
function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('.dropzone input[type=file]');
  if (!input) throw new Error('The drop area has no file input, so there is no way to upload');
  return input;
}

const named = (name: string) =>
  new File([new Uint8Array([37, 80, 68, 70])], name, { type: 'application/pdf' });

describe('adding documents', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem('amc.language', 'en');
    await setUpI18n();
  });

  it('shows nothing to upload until a file is chosen', async () => {
    show();
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
  });

  it('will not take a trade licence without the date the reminders are built on', async () => {
    const user = userEvent.setup();
    show();

    await user.upload(fileInput(), pdf());
    expect(await screen.findByRole('button', { name: 'Upload' })).toBeDisabled();
    expect(screen.getByText('Enter the expiry date')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Expires on (required)'), '31/01/2027');
    expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();
  });

  it('asks for the licence number on a licence, and sends it with the dates', async () => {
    const user = userEvent.setup();
    const onUploaded = show();
    uploadDocument.mockResolvedValue({ documentId: 'doc-1', documents: [] });

    await user.upload(fileInput(), pdf());
    await user.type(await screen.findByLabelText('Licence number'), 'CN-1234567');
    await user.type(screen.getByLabelText('Issued on'), '01/02/2026');
    await user.type(screen.getByLabelText('Expires on (required)'), '31/01/2027');
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() =>
      expect(uploadDocument).toHaveBeenCalledWith('c-1', expect.any(File), {
        type: 'trade_licence',
        referenceNumber: 'CN-1234567',
        issuedOn: '2026-02-01',
        expiresOn: '2027-01-31',
      }),
    );
    expect(onUploaded).toHaveBeenCalledWith([]);
  });

  it('asks for the ID number on an Emirates ID, and no issuing authority', async () => {
    const user = userEvent.setup();
    referenceOptions.mockImplementation(async (list: string) =>
      list === 'authority'
        ? [option('authority', 'ded', 'DED', 10)]
        : [
            option('document_type', 'trade_licence', 'Trade licence', 10),
            option('document_type', 'emirates_id', 'Emirates ID', 20),
            option('document_type', 'tenancy_contract', 'Tenancy contract', 60),
          ],
    );
    show();

    await user.upload(fileInput(), named('EID_784199.pdf'));
    // Guessed from the name.
    expect(await screen.findByLabelText('ID number')).toBeInTheDocument();
    expect(screen.queryByLabelText('Issued by')).toBeNull();
  });

  it('asks for the address on a tenancy contract instead of who issued it', async () => {
    const user = userEvent.setup();
    referenceOptions.mockImplementation(async (list: string) =>
      list === 'authority'
        ? [option('authority', 'ded', 'DED', 10)]
        : [
            option('document_type', 'trade_licence', 'Trade licence', 10),
            option('document_type', 'tenancy_contract', 'Tenancy contract', 60),
          ],
    );
    uploadDocument.mockResolvedValue({ documentId: 'doc-1', documents: [] });
    show();

    await user.upload(fileInput(), named('Ejari 2026.pdf'));
    await user.type(await screen.findByLabelText('Address'), 'Office 523, DAFZA');
    expect(screen.queryByLabelText('Issued by')).toBeNull();
    await user.type(screen.getByLabelText('Expires on (required)'), '31/12/2026');
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() =>
      expect(uploadDocument).toHaveBeenCalledWith(
        'c-1',
        expect.any(File),
        expect.objectContaining({ type: 'tenancy_contract', label: 'Office 523, DAFZA' }),
      ),
    );
  });

  it('takes several documents at once, each with its own details', async () => {
    const user = userEvent.setup();
    uploadDocument.mockResolvedValue({ documentId: 'doc-1', documents: [] });
    show();

    await user.upload(fileInput(), [named('licence.pdf'), named('bank letter.pdf')]);
    expect(await screen.findByText('licence.pdf')).toBeInTheDocument();
    expect(screen.getByText('bank letter.pdf')).toBeInTheDocument();
    // The licence needs its expiry; the bank letter does not.
    await user.type(screen.getByLabelText('Expires on (required)'), '31/01/2027');
    await user.click(screen.getByRole('button', { name: 'Upload 2 documents' }));

    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(2));
    expect(uploadDocument.mock.calls.map((call) => call[2].type)).toEqual([
      'trade_licence',
      'bank_letter',
    ]);
  });

  it('keeps a refused document on the list with the reason, and sends the rest', async () => {
    const user = userEvent.setup();
    uploadDocument
      .mockRejectedValueOnce(new Error('This system keeps PDFs and scans; that is neither'))
      .mockResolvedValueOnce({ documentId: 'doc-2', documents: [] });
    show();

    await user.upload(fileInput(), [named('licence.pdf'), named('bank letter.pdf')]);
    await user.type(await screen.findByLabelText('Expires on (required)'), '31/01/2027');
    await user.click(screen.getByRole('button', { name: 'Upload 2 documents' }));

    expect(
      await screen.findByText('This system keeps PDFs and scans; that is neither'),
    ).toBeInTheDocument();
    expect(screen.getByText('licence.pdf')).toBeInTheDocument();
    expect(screen.queryByText('bank letter.pdf')).toBeNull();
  });

  it('asks for a description only when the type would not tell them apart', async () => {
    const user = userEvent.setup();
    show();

    await user.upload(fileInput(), pdf());
    await screen.findByLabelText('Licence number');
    expect(screen.queryByLabelText('Description')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Document type'), 'other');
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
  });
});
