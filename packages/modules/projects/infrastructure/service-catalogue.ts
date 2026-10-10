import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CustomServiceRepository, StoredService } from '../application/manage-services.js';
import type { ServiceCatalogue } from '../application/ports.js';
import {
  ALL_SERVICES,
  type ServiceCode,
  type ServiceTemplate,
  defineCustomService,
  isCustomServiceCode,
  templateFor,
} from '../domain/index.js';

type Db = PostgresJsDatabase<Record<string, unknown>>;

/** A type alias, not an interface: `db.execute<T>` wants an index signature. */
export type CustomServiceRow = {
  code: string;
  name_en: string;
  name_ar: string;
  deadline_days: number | null;
  steps: { nameEn: string; nameAr: string }[];
  required_documents: { type: string; mandatory: boolean }[];
  retired_at: string | null;
  position: number;
};

export function toTemplate(row: CustomServiceRow): ServiceTemplate | null {
  /*
   * Through the same validation that wrote it. A row edited by hand into
   * something the rules refuse reads as absent here rather than as a template
   * the engine then trips over halfway through starting a project.
   */
  const defined = defineCustomService(row.code, {
    nameEn: row.name_en,
    nameAr: row.name_ar,
    deadlineDays: row.deadline_days,
    steps: row.steps,
    requiredDocuments: row.required_documents,
  });
  return defined.ok ? defined.value : null;
}

/**
 * The eleven in code, and the ones the firm added.
 *
 * The built-ins are answered without touching the database, so the common
 * path costs nothing and a database that is down cannot stop somebody
 * opening a VAT return.
 */
export class DrizzleServiceCatalogue implements ServiceCatalogue {
  constructor(private readonly db: Db) {}

  async find(code: ServiceCode): Promise<ServiceTemplate | null> {
    const builtIn = templateFor(code);
    if (builtIn) return builtIn;
    if (!isCustomServiceCode(code)) return null;

    const rows = await this.db.execute<CustomServiceRow>(sql`
      SELECT * FROM custom_services WHERE code = ${code} LIMIT 1
    `);
    return rows[0] ? toTemplate(rows[0]) : null;
  }

  async offered(): Promise<ServiceTemplate[]> {
    const rows = await this.db.execute<CustomServiceRow>(sql`
      SELECT * FROM custom_services WHERE retired_at IS NULL ORDER BY position, created_at
    `);
    const custom = rows
      .map(toTemplate)
      .filter((template): template is ServiceTemplate => template !== null);
    return [...ALL_SERVICES, ...custom];
  }

  async retired(): Promise<ServiceTemplate[]> {
    const rows = await this.db.execute<CustomServiceRow>(sql`
      SELECT * FROM custom_services WHERE retired_at IS NOT NULL ORDER BY position, created_at
    `);
    return rows
      .map(toTemplate)
      .filter((template): template is ServiceTemplate => template !== null);
  }
}

/** Writing the services the firm added. Reading them is the catalogue's job. */
export class DrizzleCustomServiceRepository implements CustomServiceRepository {
  constructor(private readonly db: Db) {}

  async all(): Promise<StoredService[]> {
    const rows = await this.db.execute<CustomServiceRow>(sql`
      SELECT * FROM custom_services ORDER BY position, created_at
    `);
    return rows.flatMap((row) => {
      const stored = toStored(row);
      return stored ? [stored] : [];
    });
  }

  async find(code: string): Promise<StoredService | null> {
    const rows = await this.db.execute<CustomServiceRow>(sql`
      SELECT * FROM custom_services WHERE code = ${code} LIMIT 1
    `);
    return rows[0] ? toStored(rows[0]) : null;
  }

  async insert(params: {
    template: ServiceTemplate;
    deadlineDays: number | null;
    position: number;
    createdBy: string;
  }): Promise<void> {
    const { template } = params;
    await this.db.execute(sql`
      INSERT INTO custom_services
        (code, name_en, name_ar, deadline_days, steps, required_documents, position, created_by)
      VALUES (
        ${template.code}, ${template.nameEn}, ${template.nameAr}, ${params.deadlineDays},
        ${JSON.stringify(template.tasks.map(({ nameEn, nameAr }) => ({ nameEn, nameAr })))}::jsonb,
        ${JSON.stringify(template.requiredDocuments)}::jsonb,
        ${params.position}, ${params.createdBy}
      )
    `);
  }

  async update(params: {
    template: ServiceTemplate;
    deadlineDays: number | null;
    retired: boolean;
  }): Promise<void> {
    const { template } = params;
    await this.db.execute(sql`
      UPDATE custom_services SET
        name_en = ${template.nameEn},
        name_ar = ${template.nameAr},
        deadline_days = ${params.deadlineDays},
        steps = ${JSON.stringify(template.tasks.map(({ nameEn, nameAr }) => ({ nameEn, nameAr })))}::jsonb,
        required_documents = ${JSON.stringify(template.requiredDocuments)}::jsonb,
        retired_at = ${params.retired ? sql`COALESCE(retired_at, now())` : null}
      WHERE code = ${template.code}
    `);
  }
}

function toStored(row: CustomServiceRow): StoredService | null {
  const template = toTemplate(row);
  return template
    ? { template, deadlineDays: row.deadline_days, retired: row.retired_at !== null }
    : null;
}
