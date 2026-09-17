import { and, desc, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GeneratedLetter, LetterRepository } from '../application/ports.js';
import { DocumentTemplate } from '../domain/letter.js';
import { documentTemplates, generatedDocuments } from './schema.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

export class DrizzleLetterRepository implements LetterRepository {
  constructor(private readonly db: Db) {}

  async templates(): Promise<DocumentTemplate[]> {
    const rows = await this.db
      .select()
      .from(documentTemplates)
      .where(isNull(documentTemplates.retiredAt))
      .orderBy(documentTemplates.code);

    return rows.map((row) => DocumentTemplate.rehydrate(row));
  }

  async templateByCode(code: string): Promise<DocumentTemplate | null> {
    const [row] = await this.db
      .select()
      .from(documentTemplates)
      .where(and(eq(documentTemplates.code, code), isNull(documentTemplates.retiredAt)))
      .limit(1);

    return row ? DocumentTemplate.rehydrate(row) : null;
  }

  async record(letter: GeneratedLetter): Promise<void> {
    await this.db.insert(generatedDocuments).values({
      id: letter.id,
      clientId: letter.clientId,
      templateId: letter.templateId,
      taskId: letter.taskId,
      language: letter.language,
      title: letter.title,
      body: letter.body,
      generatedBy: letter.generatedBy,
      createdAt: letter.createdAt,
    });
  }

  async forClient(clientId: string): Promise<GeneratedLetter[]> {
    const rows = await this.db
      .select()
      .from(generatedDocuments)
      .where(eq(generatedDocuments.clientId, clientId))
      .orderBy(desc(generatedDocuments.createdAt))
      .limit(50);

    return rows.map((row) => ({
      id: row.id,
      clientId: row.clientId,
      templateId: row.templateId,
      taskId: row.taskId,
      language: row.language as 'en' | 'ar',
      title: row.title,
      body: row.body,
      generatedBy: row.generatedBy,
      createdAt: row.createdAt,
    }));
  }
}
