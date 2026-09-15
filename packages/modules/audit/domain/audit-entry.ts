import type { Actor } from '@amc/kernel';

/**
 * One recorded fact: who did what to which thing, and what it looked like
 * before and after.
 *
 * The actor's roles and name are copied in rather than joined to. Six months
 * later the question is what that person could do at the time, not what they
 * can do now, and a join would quietly answer the wrong one.
 */
export interface AuditEntry {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorUserId: string | null;
  readonly actorRoles: readonly string[];
  readonly actorLabel: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly ipAddress: string | null;
  readonly requestId: string | null;
  readonly sessionId: string | null;
}

export interface AuditDraft {
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
}

/**
 * Actions the system performs for itself: a recurring task created overnight,
 * an escalation fired by the clock. They have no human actor, and pretending
 * otherwise would put a person's name against something they never did.
 */
export const SYSTEM_ACTOR: Actor = { userId: 'system', roles: ['system'] };

export function isSystem(actor: Actor): boolean {
  return actor.userId === SYSTEM_ACTOR.userId;
}

/**
 * Field names whose values must never reach the log. The audit trail records
 * that a password changed, never what it changed to, and the same goes for
 * every secret the system holds.
 */
const NEVER_RECORD = new Set([
  'password',
  'passwordhash',
  'totpsecret',
  'tokenhash',
  'token',
  'secret',
  'emarataxpassword',
  'accesstoken',
  'refreshtoken',
  'apikey',
]);

/**
 * Replaces secret values with a marker, keeping the field so that a reader can
 * still see that it changed. Applied to every entry on the way in, so a caller
 * cannot forget.
 */
export function redact(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (NEVER_RECORD.has(key.toLowerCase().replace(/[_-]/g, ''))) {
      output[key] = entry === null || entry === undefined ? entry : '[redacted]';
      continue;
    }
    output[key] =
      entry !== null &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      !(entry instanceof Date)
        ? redact(entry as Record<string, unknown>)
        : entry;
  }
  return output;
}
