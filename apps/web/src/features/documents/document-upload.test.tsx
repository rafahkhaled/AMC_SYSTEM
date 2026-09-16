import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setUpI18n } from '../../i18n/index.js';
import { DocumentUpload } from './document-upload.js';

const uploadDocument = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ uploadDocument, documentLink: vi.fn() }));

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

describe('adding a document', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.setItem('amc.language', 'en');
    await setUpI18n();
  });

  it('cannot be submitted with no file', async () => {
    show();
    expect(await screen.findByRole('button', { name: 'Upload' })).toBeDisabled();
  });

  it('will not take a trade licence without the date the reminders are built on', async () => {
    // The server refuses this too. Asking here means the person is told before
    // they upload rather than after, and the date is what puts the client into
    // the 90, 60 and 30 day chase.
    const user = userEvent.setup();
    show();

    await user.upload(fileInput(), pdf());

    expect(screen.getByText('licence.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
    expect(screen.getByText('Expires on (required)')).toBeInTheDocument();
  });

  it('takes a document type that does not expire with no date at all', async () => {
    const user = userEvent.setup();
    show();

    await user.upload(fileInput(), pdf());
    await user.selectOptions(screen.getByLabelText('Document type'), 'bank_letter');

    expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();
    expect(screen.queryByText('Expires on (required)')).not.toBeInTheDocument();
  });

  it('sends the file and the dates, and hands back the new list', async () => {
    const user = userEvent.setup();
    const onUploaded = show();
    uploadDocument.mockResolvedValue({ documentId: 'doc-1', documents: [] });

    await user.upload(fileInput(), pdf());
    await user.type(screen.getByLabelText('Issued on'), '2026-02-01');
    await user.type(screen.getByLabelText('Expires on (required)'), '2027-01-31');
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    expect(uploadDocument).toHaveBeenCalledWith('c-1', expect.any(File), {
      type: 'trade_licence',
      issuedOn: '2026-02-01',
      expiresOn: '2027-01-31',
    });
    expect(onUploaded).toHaveBeenCalledWith([]);
  });

  it('shows what the server said when it refuses', async () => {
    const user = userEvent.setup();
    show();
    uploadDocument.mockRejectedValue(
      new Error('This system keeps PDFs and scans; that is neither'),
    );

    await user.upload(fileInput(), pdf());
    await user.type(screen.getByLabelText('Expires on (required)'), '2027-01-31');
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    expect(
      await screen.findByText('This system keeps PDFs and scans; that is neither'),
    ).toBeInTheDocument();
  });

  it('asks for a description only when the type would not tell them apart', async () => {
    const user = userEvent.setup();
    show();

    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Document type'), 'other');
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
  });
});
