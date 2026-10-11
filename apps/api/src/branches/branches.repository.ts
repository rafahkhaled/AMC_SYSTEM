import { type BranchRow, toBranchView } from '@amc/billing/infrastructure';
import type { BranchView, CreateBranchRequest, UpdateBranchRequest } from '@amc/contracts';
import { createBranchSchema } from '@amc/contracts';
import type { Database } from '@amc/database';
import type { UnitOfWork } from '@amc/kernel';
import { Conflict, type Result, actorFrom, err, ok } from '@amc/kernel';
import { sql } from 'drizzle-orm';

/**
 * Turns an English name into a code: `Ajman Branch` becomes `ajman_branch`.
 *
 * Generated, never typed, for the same reason services are: an administrator
 * choosing codes is how two branches end up answering to one. Every document
 * issued under a branch stores the code, so it never changes afterwards.
 */
export function branchCodeFor(nameEn: string, taken: ReadonlySet<string>): string | null {
  const slug = nameEn
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
  if (slug.length === 0 || !/^[a-z]/.test(slug)) return null;

  if (!taken.has(slug)) return slug;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    if (!taken.has(`${slug}_${suffix}`)) return `${slug}_${suffix}`;
  }
  return null;
}

/**
 * The firm's branches (feedback item 12b).
 *
 * Reference data with no behaviour beyond "has these details", so it lives
 * here beside the other adapters rather than becoming a module. It is still
 * audited: which branch's bank account an invoice prints is exactly the kind
 * of thing somebody asks about after a payment goes astray.
 */
export class Branches {
  constructor(
    private readonly db: Database,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  /** Retired ones included, so a label for an old document can still be found. */
  async all(): Promise<BranchView[]> {
    const rows = await this.db.execute<BranchRow>(sql`
      SELECT * FROM branches ORDER BY retired_at IS NOT NULL, position, code
    `);
    return rows.map(toBranchView);
  }

  async add(
    caller: Parameters<typeof actorFrom>[0],
    input: CreateBranchRequest,
  ): Promise<Result<string, Conflict>> {
    const parsed = createBranchSchema.parse(input);

    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const transaction = (context as unknown as { db: Database }).db;
      const taken = new Set(
        (await transaction.execute<{ code: string }>(sql`SELECT code FROM branches`)).map(
          (row) => row.code,
        ),
      );
      const code = branchCodeFor(parsed.nameEn, taken);
      if (!code) return err(new Conflict('Give the English name using letters or numbers'));

      await transaction.execute(sql`
        INSERT INTO branches
          (code, name_en, name_ar, addresses, bank_account_holder, bank_iban, bank_bic,
           logo_url, stamp_url, position)
        VALUES (
          ${code}, ${parsed.nameEn}, ${parsed.nameAr}, ${JSON.stringify(parsed.addresses)}::jsonb,
          ${parsed.bank?.accountHolder ?? null}, ${parsed.bank?.iban ?? null},
          ${parsed.bank?.bic ?? null}, ${parsed.logoUrl}, ${parsed.stampUrl}, ${taken.size}
        )
      `);
      context.audit({
        action: 'branches.branch.added',
        entityType: 'branch',
        entityId: code,
        after: { code, nameEn: parsed.nameEn, nameAr: parsed.nameAr },
      });
      return ok(code);
    });
  }

  async change(
    caller: Parameters<typeof actorFrom>[0],
    code: string,
    changes: UpdateBranchRequest,
  ): Promise<Result<true, Conflict>> {
    return this.unitOfWork.run(actorFrom(caller), async (context) => {
      const transaction = (context as unknown as { db: Database }).db;
      const [current] = await transaction.execute<BranchRow>(
        sql`SELECT * FROM branches WHERE code = ${code} LIMIT 1`,
      );
      if (!current) return err(new Conflict('No such branch'));
      const before = toBranchView(current);

      // Only what was sent is changed. A bank of `null` means "use the firm's",
      // which is a change, so presence is checked and not truthiness.
      const has = <K extends keyof UpdateBranchRequest>(key: K) => changes[key] !== undefined;
      const bank = has('bank') ? changes.bank : before.bank;

      await transaction.execute(sql`
        UPDATE branches SET
          name_en = ${changes.nameEn ?? before.nameEn},
          name_ar = ${changes.nameAr ?? before.nameAr},
          addresses = ${JSON.stringify(changes.addresses ?? before.addresses)}::jsonb,
          bank_account_holder = ${bank?.accountHolder ?? null},
          bank_iban = ${bank?.iban ?? null},
          bank_bic = ${bank?.bic ?? null},
          logo_url = ${has('logoUrl') ? (changes.logoUrl ?? null) : before.logoUrl},
          stamp_url = ${has('stampUrl') ? (changes.stampUrl ?? null) : before.stampUrl},
          retired_at = CASE
            WHEN ${changes.retired ?? null}::boolean IS NULL THEN retired_at
            WHEN ${changes.retired ?? false} THEN coalesce(retired_at, now())
            ELSE NULL
          END
        WHERE code = ${code}
      `);

      const retiredChanged = has('retired') && changes.retired !== before.retired;
      context.audit({
        action: retiredChanged
          ? changes.retired
            ? 'branches.branch.retired'
            : 'branches.branch.restored'
          : 'branches.branch.changed',
        entityType: 'branch',
        entityId: code,
        before: { nameEn: before.nameEn, addresses: before.addresses, bank: before.bank },
        after: changes as Record<string, unknown>,
      });
      return ok(true as const);
    });
  }
}
