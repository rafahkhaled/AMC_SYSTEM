import { createDatabase } from '@amc/database';
import { sql } from 'drizzle-orm';
import { readEnvironment } from '../config/env.js';

/**
 * Plausible data to look at.
 *
 * Deliberately not called a fixture: it exists so the screens can be shown to
 * someone, and so the tax rules are visible where they are easy to get wrong.
 * Three clients on three different VAT cycles, because assuming calendar
 * quarters is the mistake this system most needs to not make.
 *
 *   pnpm seed-demo          adds it
 *   pnpm seed-demo --clear  removes it and nothing else
 */
const CLIENTS = [
  {
    id: 'demo-gulf',
    name: 'Gulf Trading LLC',
    arabic: 'الخليج للتجارة ذ.م.م',
    trn: '100123456700003',
    // Quarters ending January, April, July, October.
    anchor: 1,
    yearEnd: 12,
    rate: 35_000,
  },
  {
    id: 'demo-marina',
    name: 'Marina Contracting LLC',
    arabic: 'مارينا للمقاولات ذ.م.م',
    trn: '100234567800003',
    // Calendar quarters.
    anchor: 3,
    yearEnd: 12,
    rate: 30_000,
  },
  {
    id: 'demo-noor',
    name: 'Noor Medical Supplies FZE',
    arabic: 'نور للمستلزمات الطبية',
    trn: '100345678900003',
    // Quarters ending February, May, August, November.
    anchor: 2,
    yearEnd: 6,
    rate: 40_000,
  },
];

async function main(): Promise<void> {
  const clearing = process.argv.includes('--clear');
  const { db, close } = createDatabase({ url: readEnvironment().DATABASE_URL, maxConnections: 1 });

  try {
    if (clearing) {
      await db.execute(sql`DELETE FROM clients WHERE id LIKE 'demo-%'`);
      process.stdout.write('Demo data removed\n');
      return;
    }

    for (const client of CLIENTS) {
      await db.execute(sql`
        INSERT INTO clients (
          id, legal_name, legal_name_arabic, trade_licence_number, status,
          vat_state, vat_trn, vat_registered_on, vat_frequency, vat_anchor_end_month,
          ct_state, ct_trn, ct_registered_on, financial_year_end_month
        ) VALUES (
          ${client.id}, ${client.name}, ${client.arabic}, ${`CN-${client.id.slice(5)}`}, 'active',
          'registered', ${client.trn}, '2024-01-01', 'quarterly', ${client.anchor},
          'registered', ${`2${client.trn.slice(1)}`}, '2024-06-01', ${client.yearEnd}
        )
        ON CONFLICT (id) DO NOTHING
      `);

      await db.execute(sql`
        INSERT INTO client_rates (id, client_id, per_hour_minor, effective_from, changed_by, note)
        VALUES (${`${client.id}-rate`}, ${client.id}, ${client.rate}, '2026-01-01', 'seed',
                'agreed at onboarding')
        ON CONFLICT DO NOTHING
      `);

      // A licence expiring soon, so the expiry states are visible rather than
      // all reading "valid".
      const daysAway = client.id === 'demo-marina' ? 25 : client.id === 'demo-noor' ? -10 : 200;
      await db.execute(sql`
        INSERT INTO client_documents (
          id, client_id, type, status, storage_key, original_name, checksum, issued_on, expires_on
        ) VALUES (
          ${`${client.id}-licence`}, ${client.id}, 'trade_licence', 'held',
          ${`clients/${client.id}/documents/licence.pdf`}, 'trade-licence.pdf',
          ${'a'.repeat(64)}, '2024-01-01', CURRENT_DATE + ${daysAway}::integer
        )
        ON CONFLICT DO NOTHING
      `);

      // One document still outstanding, so a checklist has something on it.
      await db.execute(sql`
        INSERT INTO client_documents (id, client_id, type, status)
        VALUES (${`${client.id}-eid`}, ${client.id}, 'emirates_id', 'required')
        ON CONFLICT DO NOTHING
      `);

      for (const service of ['vat_return', 'monthly_accounting'] as const) {
        await db.execute(sql`
          INSERT INTO client_services (id, client_id, service, active_from)
          VALUES (${`${client.id}-${service}`}, ${client.id}, ${service}, '2026-01-01')
          ON CONFLICT DO NOTHING
        `);
      }
    }

    process.stdout.write(
      `Seeded ${CLIENTS.length} clients on three different VAT cycles.\nRun the worker once to create the tasks their closed periods call for.\n`,
    );
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Seeding failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
