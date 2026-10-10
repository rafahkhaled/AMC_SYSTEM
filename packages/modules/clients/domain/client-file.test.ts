import { describe, expect, it } from 'vitest';
import { ClientFile, cleanFileName, extensionOfName, refuseFile } from './client-file.js';

const NOW = new Date('2026-10-10T08:00:00Z');

function receive(over: Partial<Parameters<typeof ClientFile.receive>[0]> = {}) {
  return ClientFile.receive({
    id: 'f-1',
    clientId: 'c-1',
    storageKey: 'clients/c-1/files/f-1.xlsx',
    name: 'Bank statements 2026.xlsx',
    contentType: 'application/octet-stream',
    checksum: 'abc',
    sizeBytes: 2048,
    uploadedBy: 'u-1',
    now: NOW,
    ...over,
  });
}

describe('a file in a client’s folder', () => {
  it('takes any ordinary file, whatever it is', () => {
    for (const name of [
      'a.xlsx',
      'letter.docx',
      'photos.zip',
      'notes.txt',
      'data.csv',
      'scan.pdf',
      'noextension',
    ]) {
      expect(receive({ name }).ok).toBe(true);
    }
  });

  it('records who put it there, in the audit trail', () => {
    const made = receive();
    if (!made.ok) throw made.error;

    const [event] = made.value.pullEvents();
    expect(event?.name).toBe('clients.file.uploaded');
    expect(event?.payload).toMatchObject({
      clientId: 'c-1',
      name: 'Bank statements 2026.xlsx',
      sizeBytes: 2048,
    });
  });

  it('refuses a program, however it is capitalised', () => {
    for (const name of ['setup.exe', 'RUN.BAT', 'installer.msi', 'x.ps1', 'a.JS', 'tool.jar']) {
      const made = receive({ name });
      expect(made.ok).toBe(false);
      if (!made.ok) expect(made.error.message).toContain('programs are not kept');
    }
  });

  it('judges by the last extension, so a program cannot hide in the middle of a name', () => {
    expect(receive({ name: 'invoice.pdf.exe' }).ok).toBe(false);
    // And a name that merely mentions one is a perfectly good file.
    expect(receive({ name: 'how to install the exe.pdf' }).ok).toBe(true);
  });

  it('refuses an empty file, which is nearly always a failed export', () => {
    const made = receive({ sizeBytes: 0 });
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.error.message).toContain('is empty');
  });

  it('refuses a file with no name', () => {
    expect(receive({ name: '   ' }).ok).toBe(false);
    expect(refuseFile('', 10)).not.toBeNull();
  });
});

describe('the name it is kept under', () => {
  it('drops any path the browser sent, in either direction', () => {
    expect(cleanFileName('C:\\Users\\Layla\\Desktop\\statement.pdf')).toBe('statement.pdf');
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
  });

  it('removes control characters and quotes, which break a download header', () => {
    expect(cleanFileName('bad"name\u0000.pdf')).toBe('badname.pdf');
  });

  it('keeps Arabic names as they are', () => {
    expect(cleanFileName('كشف الحساب.pdf')).toBe('كشف الحساب.pdf');
  });

  it('cuts a very long name but keeps what tells you how to open it', () => {
    const cleaned = cleanFileName(`${'a'.repeat(400)}.xlsx`);
    expect(cleaned.length).toBeLessThanOrEqual(200);
    expect(cleaned.endsWith('.xlsx')).toBe(true);
  });

  it('reads the last extension only', () => {
    expect(extensionOfName('archive.tar.gz')).toBe('gz');
    expect(extensionOfName('.hidden')).toBe('');
    expect(extensionOfName('plain')).toBe('');
  });
});

describe('taking it out of the folder', () => {
  it('keeps the record, and says who and when', () => {
    const made = receive();
    if (!made.ok) throw made.error;
    made.value.pullEvents();

    const removed = made.value.remove('u-2', new Date('2026-10-11T08:00:00Z'));
    expect(removed.ok).toBe(true);
    expect(made.value.isRemoved).toBe(true);
    expect(made.value.snapshot()).toMatchObject({ removedBy: 'u-2' });
    expect(made.value.pullEvents()[0]?.name).toBe('clients.file.removed');
  });

  it('cannot be removed twice, which would write a second audit row for one act', () => {
    const made = receive();
    if (!made.ok) throw made.error;
    made.value.remove('u-2', NOW);
    expect(made.value.remove('u-2', NOW).ok).toBe(false);
  });
});
