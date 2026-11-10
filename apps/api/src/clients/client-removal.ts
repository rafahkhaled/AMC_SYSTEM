import { DrizzleUnitOfWork } from '@amc/audit/infrastructure';
import type { Database } from '@amc/database';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import { SystemClock, actorFrom } from '@amc/kernel';
import type { FileStorage } from '@amc/storage';
import {
  ConflictException,
  Controller,
  Delete,
  Inject,
  Module,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { DATABASE } from '../persistence/database.module.js';
import { FILE_STORAGE, StorageModule } from '../storage/storage.module.js';

/**
 * Deleting a client, and everything filed under them.
 *
 * Here rather than in the clients module because it reaches across all of
 * them: the client's jobs and the time on them, their quotations, documents,
 * files, folders, logins, letters and conversations. Most of that goes with
 * the row by itself (ON DELETE CASCADE); what holds on to it is cleared first.
 *
 * A client who has been sent a statement or an invoice is kept. That is what
 * they were charged, and the firm's books have to be able to say so; such a
 * client is closed instead.
 */
export class ClientRemoval {
  constructor(
    private readonly db: Database,
    private readonly storage: FileStorage,
  ) {}

  async remove(caller: Caller, clientId: string): Promise<'deleted' | 'missing' | 'billed'> {
    const unitOfWork = new DrizzleUnitOfWork(this.db, { next: () => ulid() }, new SystemClock());
    const outcome = await unitOfWork.run(actorFrom(caller), async (context) => {
      const tx = (context as unknown as { db: Database }).db;
      const [client] = await tx.execute<{ legal_name: string; billed: boolean }>(sql`
          SELECT legal_name,
                 (EXISTS (SELECT 1 FROM invoices WHERE client_id = c.id)
                   OR EXISTS (SELECT 1 FROM statements WHERE client_id = c.id)) AS billed
            FROM clients c WHERE c.id = ${clientId}
        `);
      if (!client) return { result: 'missing' as const, keys: [] };
      if (client.billed) return { result: 'billed' as const, keys: [] };

      // Where the client's files are kept, to be removed once this commits.
      const keys = (
        await tx.execute<{ key: string }>(sql`
            SELECT storage_key AS key FROM client_documents
             WHERE client_id = ${clientId} AND storage_key IS NOT NULL
            UNION ALL
            SELECT storage_key FROM client_files WHERE client_id = ${clientId}
            UNION ALL
            SELECT a.storage_key FROM contact_log_attachments a
              JOIN client_contact_log l ON l.id = a.entry_id
             WHERE l.client_id = ${clientId}
          `)
      ).map((row) => row.key);

      // What holds on to the client or its jobs rather than going with them.
      await tx.execute(sql`
          DELETE FROM time_entries
           WHERE assignment_id IN (
             SELECT a.id FROM project_assignments a
               JOIN projects p ON p.id = a.project_id
              WHERE p.client_id = ${clientId})
        `);
      await tx.execute(sql`DELETE FROM quotations WHERE client_id = ${clientId}`);
      await tx.execute(sql`DELETE FROM client_files WHERE client_id = ${clientId}`);
      await tx.execute(sql`DELETE FROM client_folders WHERE client_id = ${clientId}`);
      await tx.execute(sql`DELETE FROM clients WHERE id = ${clientId}`);

      context.audit({
        action: 'clients.client.deleted',
        entityType: 'client',
        entityId: clientId,
        before: { legalName: client.legal_name, files: keys.length },
      });
      return { result: 'deleted' as const, keys };
    });

    // After the commit, so a refusal never leaves a client without its files.
    // A file left behind is only space; a client pointing at a missing file is worse.
    for (const key of outcome.keys) {
      await this.storage.delete(key).catch(() => undefined);
    }
    return outcome.result;
  }
}

@Controller('clients')
export class ClientRemovalController {
  constructor(@Inject(ClientRemoval) private readonly removal: ClientRemoval) {}

  /** The manager's: it cannot be undone. */
  @Delete(':id')
  @RequirePermissions('users.manage')
  async remove(@CurrentCaller() caller: Caller, @Param('id') id: string): Promise<{ ok: true }> {
    const outcome = await this.removal.remove(caller, id);
    if (outcome === 'missing') throw new NotFoundException('No such client');
    if (outcome === 'billed') {
      throw new ConflictException(
        'This client has statements or invoices, so it is kept; mark it closed instead',
      );
    }
    return { ok: true };
  }
}

@Module({
  imports: [StorageModule],
  controllers: [ClientRemovalController],
  providers: [
    {
      provide: ClientRemoval,
      inject: [DATABASE, FILE_STORAGE],
      useFactory: (db: Database, storage: FileStorage) => new ClientRemoval(db, storage),
    },
  ],
})
export class ClientRemovalModule {}
