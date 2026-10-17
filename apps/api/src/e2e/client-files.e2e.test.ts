import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Session, type TestApp, bootTestApp } from '../testing/test-app.js';

/**
 * The folder every client has: any file, kept with them.
 *
 * Driven as the browser drives it — multipart, a cookie, and a download link
 * that is then followed — because the places this goes wrong are the ones a
 * unit test never sees: a filename read with the wrong character set, a limit
 * that answers with a stack trace, a link that serves a file as a web page.
 */
describe('a client’s folder of files', () => {
  let t: TestApp;
  let manager: Session;
  let accountant: Session;
  let dataEntry: Session;

  beforeAll(async () => {
    t = await bootTestApp();
    manager = await t.as('manager');
    accountant = await t.as('accountant');
    dataEntry = await t.as('data_entry');
    await t.client('c-mine', 'Gulf Trading LLC', { assignTo: [accountant] });
    await t.client('c-theirs', 'Noor Medical Supplies FZE');
  });
  afterAll(async () => {
    await t.close();
  });

  const upload = (who: Session, client: string, files: [string, Buffer][]) => {
    const call = who.post(`/clients/${client}/files`);
    for (const [name, body] of files) call.attach('files', body, name);
    return call;
  };
  const names = (body: { files: { name: string }[] }) => body.files.map((file) => file.name).sort();

  it('is closed to a stranger', async () => {
    await t.anonymous().get('/clients/c-mine/files').expect(401);
    await t.anonymous().post('/clients/c-mine/files').expect(401);
  });

  it('starts empty', async () => {
    const folder = await manager.get('/clients/c-mine/files').expect(200);
    expect(folder.body.files).toEqual([]);
  });

  describe('putting files in', () => {
    it('keeps any kind of file, several at once, and says who put them there', async () => {
      const kept = await upload(manager, 'c-mine', [
        ['Bank statements 2026.xlsx', Buffer.from('xlsx bytes')],
        ['archive.zip', Buffer.from('zip bytes')],
        ['notes.txt', Buffer.from('plain text')],
      ]).expect(201);

      expect(names(kept.body)).toEqual(['Bank statements 2026.xlsx', 'archive.zip', 'notes.txt']);
      expect(kept.body.refused).toEqual([]);
      expect(kept.body.files[0]).toMatchObject({ uploadedBy: expect.stringContaining('manager') });
    });

    it('keeps an Arabic file name as it was typed', async () => {
      // Multipart parsers read a filename as latin1, so this arrived as
      // "Ø¢Ù…..." — every Arabic name in the folder would have been garbage.
      const kept = await upload(manager, 'c-mine', [
        ['كشف الحساب.pdf', Buffer.from('%PDF-1.4')],
      ]).expect(201);
      expect(names(kept.body)).toContain('كشف الحساب.pdf');
    });

    it('keeps the good files and names each one that was refused, with the reason', async () => {
      const outcome = await upload(manager, 'c-mine', [
        ['good.docx', Buffer.from('word')],
        ['setup.exe', Buffer.from('MZ program')],
        ['empty.txt', Buffer.alloc(0)],
      ]).expect(201);

      expect(names(outcome.body)).toContain('good.docx');
      expect(names(outcome.body)).not.toContain('setup.exe');
      expect(outcome.body.refused).toEqual([
        { name: 'setup.exe', reason: expect.stringContaining('programs are not kept') },
        { name: 'empty.txt', reason: expect.stringContaining('is empty') },
      ]);
    });

    it('is a refusal, not a success, when nothing at all could be kept', async () => {
      const refused = await upload(manager, 'c-mine', [
        ['virus.bat', Buffer.from('@echo off')],
      ]).expect(400);
      expect(refused.body.error.message).toContain('programs are not kept');
    });

    it('turns back a file over the size limit with a clear answer, not a stack trace', async () => {
      const huge = Buffer.alloc(26 * 1024 * 1024, 1);
      const refused = await upload(manager, 'c-mine', [['huge.bin', huge]]);

      expect([400, 413]).toContain(refused.status);
      expect(JSON.stringify(refused.body)).not.toContain('at ');
      const folder = await manager.get('/clients/c-mine/files').expect(200);
      expect(names(folder.body)).not.toContain('huge.bin');
    });

    it('answers a client that does not exist with not found', async () => {
      await upload(manager, 'no-such-client', [['a.txt', Buffer.from('x')]]).expect(404);
    });

    it('answers a request with no file in it with a plain refusal', async () => {
      await manager.post('/clients/c-mine/files').expect(400);
    });
  });

  describe('taking them out again', () => {
    it('hands out a link that downloads the file under its own name, as an attachment', async () => {
      const kept = await upload(manager, 'c-mine', [
        ['Engagement terms.docx', Buffer.from('the terms')],
      ]).expect(201);
      const id = kept.body.files.find(
        (f: { name: string }) => f.name === 'Engagement terms.docx',
      ).id;

      const link = await manager.get(`/client-files/${id}/link`).expect(200);
      // Followed with no session: the signature is the authorisation.
      const download = await t
        .anonymous()
        .get(link.body.url.replace(/^\/api/, ''))
        .buffer(true)
        .parse((response, done) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect((download.body as Buffer).toString()).toBe('the terms');
      expect(download.headers['content-disposition']).toContain(
        'attachment; filename="Engagement terms.docx"',
      );
      // Never rendered as a page in this origin, whatever the file claims to be.
      expect(download.headers['x-content-type-options']).toBe('nosniff');
      expect(download.headers['content-type']).toContain('application/octet-stream');
    });

    it('refuses a link whose signature has been tampered with', async () => {
      const kept = await upload(manager, 'c-mine', [['signed.txt', Buffer.from('s')]]).expect(201);
      const id = kept.body.files.find((f: { name: string }) => f.name === 'signed.txt').id;
      const link = await manager.get(`/client-files/${id}/link`).expect(200);

      // Change the last character of the signature to a different one. Replacing a
      // fixed position with a fixed character is a no-op one time in sixteen.
      const forged = link.body.url.replace(
        /signature=([0-9a-f]+)/,
        (_whole: string, signature: string) =>
          `signature=${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`,
      );
      await t
        .anonymous()
        .get(forged.replace(/^\/api/, ''))
        .expect(404);
    });

    it('removes a file from the folder and stops serving it, keeping the record', async () => {
      const kept = await upload(manager, 'c-mine', [['to-remove.txt', Buffer.from('bye')]]).expect(
        201,
      );
      const id = kept.body.files.find((f: { name: string }) => f.name === 'to-remove.txt').id;

      await manager.delete(`/client-files/${id}`).expect(200);

      const folder = await manager.get('/clients/c-mine/files').expect(200);
      expect(names(folder.body)).not.toContain('to-remove.txt');
      await manager.get(`/client-files/${id}/link`).expect(404);

      // The row stays, so who removed it and when has an answer.
      const [row] = await t.sql<
        { removed_by: string | null }[]
      >`SELECT removed_by FROM client_files WHERE id = ${id}`;
      expect(row?.removed_by).toBe(manager.userId);
      await manager.delete(`/client-files/${id}`).expect(404);
    });

    it('writes the upload and the removal to the audit log, with who did them', async () => {
      const rows = await t.sql<{ action: string; actor_user_id: string }[]>`
        SELECT action, actor_user_id FROM audit_log WHERE action LIKE 'clients.file.%'
      `;
      expect(rows.map((row) => row.action)).toEqual(
        expect.arrayContaining(['clients.file.uploaded', 'clients.file.removed']),
      );
      expect(rows.every((row) => row.actor_user_id === manager.userId)).toBe(true);
    });
  });

  describe('who can see which folder', () => {
    it('shows an accountant their own client’s folder and an empty one for everybody else’s', async () => {
      await upload(manager, 'c-theirs', [['theirs.pdf', Buffer.from('%PDF-1.4')]]).expect(201);

      const mine = await accountant.get('/clients/c-mine/files').expect(200);
      expect(mine.body.files.length).toBeGreaterThan(0);
      // Not forbidden: a refusal would confirm the client exists.
      const theirs = await accountant.get('/clients/c-theirs/files').expect(200);
      expect(theirs.body.files).toEqual([]);
    });

    it('will not give an accountant a download link to a file in a client that is not theirs', async () => {
      const folder = await manager.get('/clients/c-theirs/files').expect(200);
      const id = folder.body.files[0].id;

      await manager.get(`/client-files/${id}/link`).expect(200);
      await accountant.get(`/client-files/${id}/link`).expect(404);
      await dataEntry.get(`/client-files/${id}/link`).expect(404);
    });

    it('lets only somebody with the edit permission put files in or take them out', async () => {
      await upload(accountant, 'c-mine', [['a.txt', Buffer.from('x')]]).expect(403);
      await upload(dataEntry, 'c-mine', [['a.txt', Buffer.from('x')]]).expect(403);
      await accountant.delete('/client-files/anything').expect(403);
    });
  });
});
