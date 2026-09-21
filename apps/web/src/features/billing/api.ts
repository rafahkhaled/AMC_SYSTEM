import {
  type InvoiceView,
  type StatementView,
  type Statements,
  invoiceSchema,
  invoicesSchema,
  statementSchema,
  statementsSchema,
} from '@amc/contracts';
import { request, send } from '../auth/api.js';

export async function statements(clientId?: string): Promise<StatementView[]> {
  const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
  return statementsSchema.parse(await request(`/billing/statements${query}`)).statements;
}

export async function statement(id: string): Promise<StatementView> {
  return statementSchema.parse(await request(`/billing/statements/${encodeURIComponent(id)}`));
}

export async function generate(input: {
  clientId: string;
  from: string;
  to: string;
}): Promise<StatementView> {
  return statementSchema.parse(await send('/billing/statements', input));
}

/**
 * Excluding and adjusting are one call.
 *
 * They are the same act from the reviewer's side — this line is not what the
 * client should pay — and both are refused without a reason. Leaving
 * `adjustToMinor` out excludes the line outright.
 */
export async function reviseLine(
  statementId: string,
  lineId: string,
  body: { reason: string; adjustToMinor?: number },
): Promise<StatementView> {
  return statementSchema.parse(
    await send(
      `/billing/statements/${encodeURIComponent(statementId)}/lines/${encodeURIComponent(lineId)}/revise`,
      body,
    ),
  );
}

export async function approve(id: string): Promise<StatementView> {
  return statementSchema.parse(await send(`/billing/statements/${encodeURIComponent(id)}/approve`));
}

export async function raiseInvoice(id: string): Promise<InvoiceView> {
  return invoiceSchema.parse(await send(`/billing/statements/${encodeURIComponent(id)}/invoice`));
}

export async function invoices(outstandingOnly = false): Promise<InvoiceView[]> {
  const query = outstandingOnly ? '?outstanding=true' : '';
  return invoicesSchema.parse(await request(`/billing/invoices${query}`)).invoices;
}

export async function recordPayment(
  invoiceId: string,
  body: { amountMinor: number; receivedOn: string; method: string; reference?: string },
): Promise<InvoiceView> {
  return invoiceSchema.parse(
    await send(`/billing/invoices/${encodeURIComponent(invoiceId)}/payments`, body),
  );
}

export type { Statements };
