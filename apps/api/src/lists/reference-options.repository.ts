import type { ReferenceList, ReferenceOption } from '@amc/contracts';
import type { Database } from '@amc/database';
import type { IdGenerator } from '@amc/kernel';
import { sql } from 'drizzle-orm';

/*
 * A type alias, not an interface.
 *
 * `db.execute<T>` wants `Record<string, unknown>`, and an interface has no
 * implicit index signature where a type alias does. Written as an interface
 * this refuses to compile with a message about index signatures that says
 * nothing about the cause.
 */
type Row = {
  id: string;
  list: string;
  code: string;
  name_en: string;
  name_ar: string;
  position: number;
  retired_at: string | null;
};

const toOption = (row: Row): ReferenceOption => ({
  id: row.id,
  list: row.list as ReferenceList,
  code: row.code,
  nameEn: row.name_en,
  nameAr: row.name_ar,
  position: Number(row.position),
  retired: row.retired_at !== null,
});

/**
 * The lists an administrator can extend.
 *
 * Reference data with no behaviour of its own, so it lives here beside the
 * other adapters rather than becoming a module: there is no domain rule to
 * protect, only rows to read and write.
 */
export class ReferenceOptions {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
  ) {}

  /**
   * Everything, retired included.
   *
   * A screen showing a document filed years ago still has to render its type,
   * so the caller gets the retired rows and decides: dropdowns filter them
   * out, labels do not.
   */
  async all(list?: ReferenceList): Promise<ReferenceOption[]> {
    const rows = await this.db.execute<Row>(
      list
        ? sql`SELECT * FROM reference_options WHERE list = ${list} ORDER BY position, code`
        : sql`SELECT * FROM reference_options ORDER BY list, position, code`,
    );
    return rows.map(toOption);
  }

  /** Returns null when the code is already taken in that list. */
  async add(
    list: ReferenceList,
    option: { code: string; nameEn: string; nameAr: string; position?: number | undefined },
    by: string,
  ): Promise<ReferenceOption | null> {
    const rows = await this.db.execute<Row>(sql`
      INSERT INTO reference_options (id, list, code, name_en, name_ar, position, created_by)
      VALUES (${this.ids.next()}, ${list}, ${option.code}, ${option.nameEn},
              ${option.nameAr}, ${option.position ?? 500}, ${by})
      ON CONFLICT (list, code) DO NOTHING
      RETURNING *
    `);
    return rows[0] ? toOption(rows[0]) : null;
  }

  /**
   * Labels, order, and whether it is still offered.
   *
   * The code is deliberately not changeable: every row that already uses this
   * option stores it, and renaming it there would orphan all of them.
   */
  async update(
    list: ReferenceList,
    code: string,
    changes: {
      nameEn?: string | undefined;
      nameAr?: string | undefined;
      position?: number | undefined;
      retired?: boolean | undefined;
    },
  ): Promise<ReferenceOption | null> {
    const rows = await this.db.execute<Row>(sql`
      UPDATE reference_options SET
        name_en    = coalesce(${changes.nameEn ?? null}, name_en),
        name_ar    = coalesce(${changes.nameAr ?? null}, name_ar),
        position   = coalesce(${changes.position ?? null}, position),
        retired_at = CASE
                       WHEN ${changes.retired ?? null}::boolean IS NULL THEN retired_at
                       WHEN ${changes.retired ?? false} THEN coalesce(retired_at, now())
                       ELSE NULL
                     END,
        updated_at = now()
      WHERE list = ${list} AND code = ${code}
      RETURNING *
    `);
    return rows[0] ? toOption(rows[0]) : null;
  }
}
