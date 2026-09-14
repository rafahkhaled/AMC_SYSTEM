import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * The identity of the request currently being served, available anywhere
 * without threading it through every function signature. The audit log and
 * every log line carry it, so one identifier ties a user's click to the rows it
 * wrote and the errors it caused.
 */
export interface RequestContext {
  readonly requestId: string;
  readonly ipAddress?: string | undefined;
  userId?: string | undefined;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, work: () => T): T {
  return storage.run(context, work);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Attach the acting user once authentication has resolved it. */
export function setCurrentUserId(userId: string): void {
  const context = storage.getStore();
  if (context) context.userId = userId;
}

export function newRequestId(): string {
  return randomUUID();
}
