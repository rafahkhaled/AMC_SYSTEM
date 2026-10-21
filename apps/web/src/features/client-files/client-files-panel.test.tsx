import type { ClientFileView, ClientFolderView } from '@amc/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { ClientFilesPanel } from './client-files-panel.js';

const clientFiles = vi.hoisted(() => vi.fn());
const uploadClientFiles = vi.hoisted(() => vi.fn());
const clientFileLink = vi.hoisted(() => vi.fn());
const removeClientFile = vi.hoisted(() => vi.fn());
const clientFolders = vi.hoisted(() => vi.fn());
const createClientFolder = vi.hoisted(() => vi.fn());
const renameClientFolder = vi.hoisted(() => vi.fn());
const removeClientFolder = vi.hoisted(() => vi.fn());
const moveClientFile = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({
  clientFiles,
  uploadClientFiles,
  clientFileLink,
  removeClientFile,
  clientFolders,
  createClientFolder,
  renameClientFolder,
  removeClientFolder,
  moveClientFile,
}));

const kept = (over: Partial<ClientFileView> = {}): ClientFileView => ({
  id: 'f-1',
  folderId: null,
  name: 'Bank statements 2026.xlsx',
  contentType: 'application/octet-stream',
  sizeBytes: 2_621_440,
  uploadedAt: '2026-10-09T08:00:00.000Z',
  uploadedBy: 'Wael Ajam',
  ...over,
});

const file = (name: string, size = 1000) => new File([new Uint8Array(size)], name);

beforeEach(async () => {
  vi.clearAllMocks();
  await useLanguage('en');
  clientFiles.mockResolvedValue([kept()]);
  clientFolders.mockResolvedValue([]);
});

describe('the client’s folder', () => {
  it('lists what is in it, with the size and who put it there', async () => {
    renderScreen(<ClientFilesPanel clientId="c-1" />);

    expect(await screen.findByText('Bank statements 2026.xlsx')).toBeInTheDocument();
    expect(screen.getByText('2.5 MB')).toBeInTheDocument();
    expect(screen.getByText('Wael Ajam')).toBeInTheDocument();
  });

  it('says so when the folder is empty', async () => {
    clientFiles.mockResolvedValue([]);
    renderScreen(<ClientFilesPanel clientId="c-1" />);
    expect(await screen.findByText('No files yet')).toBeInTheDocument();
  });

  it('accepts any kind of file, not only scans', async () => {
    renderScreen(<ClientFilesPanel clientId="c-1" />);
    await screen.findByText('Bank statements 2026.xlsx');

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    // No `accept` list: a spreadsheet or a zip is what this folder is for.
    expect(input.accept).toBe('');
    expect(input.multiple).toBe(true);
  });

  it('sends several files in one go, with nothing to fill in first', async () => {
    uploadClientFiles.mockResolvedValue({ files: [kept()], refused: [] });
    renderScreen(<ClientFilesPanel clientId="c-1" />);
    await screen.findByText('Bank statements 2026.xlsx');

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, [file('a.xlsx'), file('b.docx')]);

    await waitFor(() => expect(uploadClientFiles).toHaveBeenCalledTimes(1));
    const [clientId, sent] = uploadClientFiles.mock.calls[0] as [string, File[]];
    expect(clientId).toBe('c-1');
    expect(sent.map((one) => one.name)).toEqual(['a.xlsx', 'b.docx']);
  });

  it('names what the server refused and why, while keeping the rest', async () => {
    uploadClientFiles.mockResolvedValue({
      files: [kept()],
      refused: [{ name: 'setup.exe', reason: 'setup.exe is a program, and programs are not kept' }],
    });
    renderScreen(<ClientFilesPanel clientId="c-1" />);
    await screen.findByText('Bank statements 2026.xlsx');

    await userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, [
      file('a.xlsx'),
      file('setup.exe'),
    ]);

    expect(await screen.findByText('These files were not kept:')).toBeInTheDocument();
    expect(screen.getByText(/setup\.exe: setup\.exe is a program/)).toBeInTheDocument();
  });

  it('turns back a file over the limit before sending anything', async () => {
    renderScreen(<ClientFilesPanel clientId="c-1" />);
    await screen.findByText('Bank statements 2026.xlsx');

    const huge = file('video.mov', 26 * 1024 * 1024);
    await userEvent.upload(document.querySelector('input[type="file"]') as HTMLInputElement, huge);

    // Finding out after uploading twenty-six megabytes is a worse way to learn
    // the limit than being told before.
    expect(await screen.findByText(/video\.mov: Larger than 25 MB/)).toBeInTheDocument();
    expect(uploadClientFiles).not.toHaveBeenCalled();
  });

  it('accepts files dropped on it', async () => {
    uploadClientFiles.mockResolvedValue({ files: [kept()], refused: [] });
    renderScreen(<ClientFilesPanel clientId="c-1" />);
    await screen.findByText('Bank statements 2026.xlsx');

    const zone = screen
      .getByText('Drop files here, or click to choose')
      .closest('label') as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [file('dropped.zip')] } });

    await waitFor(() => expect(uploadClientFiles).toHaveBeenCalled());
  });

  it('fetches the download link only when it is asked for', async () => {
    clientFileLink.mockResolvedValue('https://files.test/x');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderScreen(<ClientFilesPanel clientId="c-1" />);

    // Not minted for every row on load: it would expire before most were used.
    await screen.findByText('Bank statements 2026.xlsx');
    expect(clientFileLink).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith('https://files.test/x', '_blank', 'noopener,noreferrer'),
    );
    open.mockRestore();
  });

  it('asks once before removing, and does nothing if you keep it', async () => {
    renderScreen(<ClientFilesPanel clientId="c-1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(removeClientFile).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(removeClientFile).not.toHaveBeenCalled();
  });

  it('removes it once confirmed', async () => {
    removeClientFile.mockResolvedValue(undefined);
    renderScreen(<ClientFilesPanel clientId="c-1" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));

    await waitFor(() => expect(removeClientFile).toHaveBeenCalledWith('f-1'));
  });

  it('shows the server’s refusal when an upload fails outright', async () => {
    uploadClientFiles.mockRejectedValue(
      new Error('setup.exe is a program, and programs are not kept'),
    );
    renderScreen(<ClientFilesPanel clientId="c-1" />);
    await screen.findByText('Bank statements 2026.xlsx');

    await userEvent.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      file('setup.exe'),
    );
    expect(await screen.findByText(/programs are not kept/)).toBeInTheDocument();
  });
});

const folder = (over: Partial<ClientFolderView> = {}): ClientFolderView => ({
  id: 'd-1',
  parentId: null,
  name: '2025',
  fileCount: 2,
  ...over,
});

describe('folders inside the client’s folder', () => {
  it('shows a folder with how many files it holds, and keeps its files out of the top', async () => {
    clientFolders.mockResolvedValue([folder()]);
    clientFiles.mockResolvedValue([
      kept(),
      kept({ id: 'f-2', name: 'inside.pdf', folderId: 'd-1' }),
    ]);
    renderScreen(<ClientFilesPanel clientId="c-1" />);

    expect(await screen.findByRole('button', { name: '2025' })).toBeInTheDocument();
    expect(screen.getByText('2 files')).toBeInTheDocument();
    expect(screen.getByText('Bank statements 2026.xlsx')).toBeInTheDocument();
    expect(screen.queryByText('inside.pdf')).toBeNull();
  });

  it('opens a folder, shows its files and a path back, and uploads into it', async () => {
    const user = userEvent.setup();
    clientFolders.mockResolvedValue([
      folder(),
      folder({ id: 'd-2', parentId: 'd-1', name: 'Statements', fileCount: 0 }),
    ]);
    clientFiles.mockResolvedValue([kept({ id: 'f-2', name: 'inside.pdf', folderId: 'd-1' })]);
    uploadClientFiles.mockResolvedValue({ files: [], refused: [] });
    renderScreen(<ClientFilesPanel clientId="c-1" />);

    await user.click(await screen.findByRole('button', { name: '2025' }));
    expect(screen.getByText('inside.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Statements' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Folder path' })).getByRole('button', {
        name: '2025',
      }),
    ).toBeInTheDocument();

    fireEvent.change(document.querySelector('input[type=file]') as HTMLInputElement, {
      target: { files: [file('new.pdf')] },
    });
    await waitFor(() => expect(uploadClientFiles).toHaveBeenCalled());
    expect(uploadClientFiles.mock.calls[0]?.[2]).toBe('d-1');

    await user.click(screen.getByRole('button', { name: 'All files' }));
    expect(screen.queryByText('inside.pdf')).toBeNull();
  });

  it('makes a folder where you are', async () => {
    const user = userEvent.setup();
    createClientFolder.mockResolvedValue([folder({ name: 'Audit' })]);
    renderScreen(<ClientFilesPanel clientId="c-1" />);

    await user.click(await screen.findByRole('button', { name: 'New folder' }));
    await user.type(screen.getByLabelText('Folder name'), 'Audit');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createClientFolder).toHaveBeenCalledWith('c-1', 'Audit', null));
  });

  it('makes a folder inside the one that is open', async () => {
    const user = userEvent.setup();
    clientFolders.mockResolvedValue([folder()]);
    createClientFolder.mockResolvedValue([folder()]);
    renderScreen(<ClientFilesPanel clientId="c-1" />);

    await user.click(await screen.findByRole('button', { name: '2025' }));
    await user.click(screen.getByRole('button', { name: 'New folder' }));
    await user.type(screen.getByLabelText('Folder name'), 'Invoices');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createClientFolder).toHaveBeenCalledWith('c-1', 'Invoices', 'd-1'));
  });

  it('shows the server’s refusal, such as a name already used', async () => {
    const user = userEvent.setup();
    createClientFolder.mockRejectedValue(
      new Error('There is already a folder with that name here'),
    );
    renderScreen(<ClientFilesPanel clientId="c-1" />);

    await user.click(await screen.findByRole('button', { name: 'New folder' }));
    await user.type(screen.getByLabelText('Folder name'), 'Audit');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(
      await screen.findByText('There is already a folder with that name here'),
    ).toBeInTheDocument();
  });

  it('renames a folder', async () => {
    const user = userEvent.setup();
    clientFolders.mockResolvedValue([folder()]);
    renameClientFolder.mockResolvedValue(undefined);
    renderScreen(<ClientFilesPanel clientId="c-1" />);

    await user.click(await screen.findByRole('button', { name: 'Rename' }));
    const field = screen.getByLabelText('Folder name');
    await user.clear(field);
    await user.type(field, 'Archive');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(renameClientFolder).toHaveBeenCalledWith('d-1', 'Archive'));
  });

  it('asks before deleting a folder, and says why when it is not empty', async () => {
    const user = userEvent.setup();
    clientFolders.mockResolvedValue([folder()]);
    removeClientFolder.mockRejectedValue(
      new Error('Move or remove what is inside this folder first'),
    );
    renderScreen(<ClientFilesPanel clientId="c-1" />);

    await user.click((await screen.findAllByRole('button', { name: 'Remove' }))[0] as HTMLElement);
    expect(removeClientFolder).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete folder' }));

    expect(
      await screen.findByText('Move or remove what is inside this folder first'),
    ).toBeInTheDocument();
  });

  it('moves a file into a folder, listing folders by their full path', async () => {
    const user = userEvent.setup();
    clientFolders.mockResolvedValue([
      folder(),
      folder({ id: 'd-2', parentId: 'd-1', name: 'Statements' }),
    ]);
    moveClientFile.mockResolvedValue(undefined);
    renderScreen(<ClientFilesPanel clientId="c-1" />);

    await user.click(await screen.findByRole('button', { name: 'Move' }));
    const select = await screen.findByLabelText('Move to');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Top level', '2025', '2025 / Statements']);
    await user.selectOptions(select, 'd-2');

    await waitFor(() => expect(moveClientFile).toHaveBeenCalledWith('f-1', 'd-2'));
  });

  it('offers no way to change anything to somebody who may not edit clients', async () => {
    clientFolders.mockResolvedValue([folder()]);
    renderScreen(<ClientFilesPanel clientId="c-1" canEdit={false} />);

    expect(await screen.findByRole('button', { name: '2025' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(screen.queryByText(/Drop files here/)).toBeNull();
    // Reading is still possible.
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });
});
