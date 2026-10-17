import type postgres from 'postgres';

/**
 * Rows that take a long way round to make through the API and are not what the
 * test is about. Written straight to the tables, with every column the real
 * constraints require, so a test about payments starts from an invoice that
 * exists without first working through time entries, a statement and an
 * approval.
 */

/**
 * The client's live engagement for a service, made if it is not there yet.
 *
 * There can be only one live one per client and service, so a test that seeds
 * two invoices for the same client has to share it rather than insert a second.
 */
async function subscriptionFor(
  sql: postgres.Sql,
  clientId: string,
  service: string,
): Promise<string> {
  await sql`
    INSERT INTO client_services (id, client_id, service, active_from)
    VALUES (${`cs-${Math.random().toString(36).slice(2, 9)}`}, ${clientId}, ${service}, '2026-01-01')
    ON CONFLICT (client_id, service) WHERE active_to IS NULL DO NOTHING
  `;
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM client_services WHERE client_id = ${clientId} AND service = ${service} AND active_to IS NULL
  `;
  return row?.id ?? '';
}

export async function seedInvoice(
  sql: postgres.Sql,
  options: {
    clientId: string;
    userId: string;
    id?: string;
    number?: string;
    /** Whole fils, before VAT. */
    netMinor?: number;
    branchCode?: string | null;
    settlement?: 'issued' | 'part_paid' | 'paid';
  },
): Promise<{ invoiceId: string; statementId: string; projectId: string }> {
  const id = options.id ?? `inv-${Math.random().toString(36).slice(2, 8)}`;
  const suffix = id.slice(4);
  const net = options.netMinor ?? 100_000;

  const subscription = await subscriptionFor(sql, options.clientId, 'vat_return');
  await sql`
    INSERT INTO projects (id, client_service_id, client_id, service, state)
    VALUES (${`pr-${suffix}`}, ${subscription}, ${options.clientId}, 'vat_return', 'in_progress')
  `;
  await sql`
    INSERT INTO statements
      (id, client_id, period_start, period_end, state, currency, created_by, approved_by, approved_at)
    VALUES (${`st-${suffix}`}, ${options.clientId}, '2026-09-01', '2026-09-30', 'invoiced', 'AED',
            ${options.userId}, ${options.userId}, now())
  `;
  await sql`
    INSERT INTO invoices
      (id, client_id, statement_id, branch_code, number, settlement, currency,
       vat_basis_points, issued_on, due_on, issued_by)
    VALUES (${id}, ${options.clientId}, ${`st-${suffix}`}, ${options.branchCode ?? null},
            ${options.number ?? String(3000 + Math.floor(Math.random() * 900))},
            ${options.settlement ?? 'issued'}, 'AED', 500, '2026-10-01', '2026-10-31',
            ${options.userId})
  `;
  await sql`
    INSERT INTO invoice_lines
      (id, invoice_id, project_id, service, description_en, description_ar,
       worked_seconds, amount_minor, position, quantity_centi, unit_minor)
    VALUES (${`il-${suffix}`}, ${id}, ${`pr-${suffix}`}, 'vat_return', 'VAT return', 'إقرار',
            7200, ${net}, 0, 100, ${net})
  `;
  return { invoiceId: id, statementId: `st-${suffix}`, projectId: `pr-${suffix}` };
}

/**
 * An approved statement with one hour-priced line, ready to be raised as an invoice.
 *
 * Two hours at 300.00 an hour is 600.00, which with five percent VAT is 630.00.
 */
export async function seedApprovedStatement(
  sql: postgres.Sql,
  options: { clientId: string; userId: string; id?: string },
): Promise<{ statementId: string }> {
  const id = options.id ?? `st-${Math.random().toString(36).slice(2, 8)}`;
  const suffix = id.slice(3);

  const subscription = await subscriptionFor(sql, options.clientId, 'vat_return');
  await sql`
    INSERT INTO projects (id, client_service_id, client_id, service, state)
    VALUES (${`pr-${suffix}`}, ${subscription}, ${options.clientId}, 'vat_return', 'in_progress')
  `;
  await sql`
    INSERT INTO statements
      (id, client_id, period_start, period_end, state, currency, created_by, approved_by, approved_at)
    VALUES (${id}, ${options.clientId}, '2026-09-01', '2026-09-30', 'approved', 'AED',
            ${options.userId}, ${options.userId}, now())
  `;
  await sql`
    INSERT INTO statement_lines
      (id, statement_id, project_id, service, performed_on, user_id, worked_seconds,
       per_hour_minor, position, pricing)
    VALUES (${`sl-${suffix}`}, ${id}, ${`pr-${suffix}`}, 'vat_return', '2026-09-03',
            ${options.userId}, 7200, 30000, 0, 'hourly')
  `;
  return { statementId: id };
}
