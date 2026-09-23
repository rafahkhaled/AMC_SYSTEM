import { type ClientQuotationView, clientQuotationSchema } from '@amc/contracts';

/**
 * The client's own calls, which carry no session.
 *
 * Deliberately not the shared `request` helper: that one sends credentials
 * and belongs to a signed-in screen. A client has no account, and a page that
 * quietly sends cookies it does not need is a page that will one day send one
 * it does.
 */
async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'omit',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    throw new Error('unavailable');
  }
  return response.json();
}

export async function openQuotation(token: string): Promise<ClientQuotationView> {
  return clientQuotationSchema.parse(await call(`/public/quotations/${encodeURIComponent(token)}`));
}

export async function answerQuotation(
  token: string,
  decision: 'accept' | 'decline',
): Promise<ClientQuotationView> {
  return clientQuotationSchema.parse(
    await call(`/public/quotations/${encodeURIComponent(token)}/answer`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
  );
}
