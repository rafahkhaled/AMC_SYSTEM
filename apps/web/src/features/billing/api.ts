import {
  type InvoiceView,
  type QuotationView,
  type StatementView,
  type Statements,
  invoiceSchema,
  invoicesSchema,
  quotationSchema,
  quotationsSchema,
  statementSchema,
  statementsSchema,
} from '@amc/contracts';
import { del, request, send } from '../auth/api.js';

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

/* ---------------------------------------------------------------- quotations */

export async function quotations(clientId?: string): Promise<QuotationView[]> {
  const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
  return quotationsSchema.parse(await request(`/billing/quotations${query}`)).quotations;
}

export async function draftQuotation(input: {
  clientId: string;
  reference: string;
  validUntil?: string;
}): Promise<QuotationView> {
  return quotationSchema.parse(await send('/billing/quotations', input));
}

export async function addQuotationLine(
  id: string,
  line: {
    descriptionEn?: string;
    descriptionAr?: string;
    hours?: number;
    perHourMinor?: number;
    amountMinor?: number;
  },
): Promise<QuotationView> {
  return quotationSchema.parse(
    await send(`/billing/quotations/${encodeURIComponent(id)}/lines`, line),
  );
}

export async function removeQuotationLine(id: string, lineId: string): Promise<QuotationView> {
  return quotationSchema.parse(
    await del(`/billing/quotations/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`),
  );
}

/**
 * Sending, and the client's answer.
 *
 * The act is in the path rather than a state in the body: three different
 * decisions with three different consequences, and a body carrying a state
 * invites this function to send whichever one it happens to hold.
 */
export async function answerQuotation(
  id: string,
  act: 'send' | 'accept' | 'decline',
): Promise<QuotationView> {
  return quotationSchema.parse(await send(`/billing/quotations/${encodeURIComponent(id)}/${act}`));
}
