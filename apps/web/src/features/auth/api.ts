import {
  type Caller,
  type SignInRequest,
  type SignInResponse,
  callerSchema,
  errorEnvelopeSchema,
  signInResponseSchema,
} from '@amc/contracts';

/**
 * Every call carries the session cookie and nothing else. There is no token in
 * JavaScript to steal, which is the whole reason the cookie is httpOnly.
 */
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function failure(response: Response): Promise<ApiError> {
  try {
    const parsed = errorEnvelopeSchema.safeParse(await response.json());
    if (parsed.success) {
      return new ApiError(
        response.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.requestId,
      );
    }
  } catch {
    /* a body that is not our envelope is still a failure */
  }
  return new ApiError(response.status, 'UNKNOWN', `Request failed (${response.status})`);
}

export async function signIn(credentials: SignInRequest): Promise<SignInResponse> {
  const response = await call('/auth/sign-in', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  if (!response.ok) throw await failure(response);
  return signInResponseSchema.parse(await response.json());
}

export async function verifyTwoFactor(code: string): Promise<void> {
  const response = await call('/auth/two-factor/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  if (!response.ok) throw await failure(response);
}

/**
 * Who the server thinks we are. A 401 is an answer, not an error: it simply
 * means nobody is signed in, and the application should show the sign-in
 * screen rather than a failure.
 */
export async function currentCaller(): Promise<Caller | null> {
  const response = await call('/auth/me');
  if (response.status === 401) return null;
  if (!response.ok) throw await failure(response);
  return callerSchema.parse(await response.json());
}

export async function signOut(): Promise<void> {
  await call('/auth/sign-out', { method: 'POST' });
}

export interface AuditEntrySummary {
  id: string;
  occurredAt: string;
  action: string;
  actorLabel: string | null;
  entityType: string;
}

export async function recentAudit(limit = 8): Promise<AuditEntrySummary[]> {
  const response = await call(`/audit?limit=${limit}`);
  if (!response.ok) throw await failure(response);
  const body = (await response.json()) as { entries: AuditEntrySummary[] };
  return body.entries;
}
