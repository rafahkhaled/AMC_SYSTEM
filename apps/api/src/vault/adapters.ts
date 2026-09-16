import { auditLog } from '@amc/audit/infrastructure';
import type { Database } from '@amc/database';
import type { IdGenerator } from '@amc/kernel';
import type { SecretAccessRecorder } from '@amc/vault';

/**
 * Writes down that a secret was read.
 *
 * Lives here because it joins the vault to the audit log and neither package
 * may depend on the other: the vault declares the shape it needs, audit owns
 * the table, and the composition root puts them together.
 *
 * It writes on its own rather than joining a unit of work, and that is
 * deliberate. Reading a credential changes nothing else, so there is no
 * transaction for it to belong to — and if it were enrolled in one, a caller
 * could read a password inside a transaction that later rolled back and the
 * record of the read would roll back with it. A password that has been shown
 * to somebody cannot be un-shown.
 *
 * The write happens before the plaintext is returned, which the vault
 * enforces. If this throws, the secret is not handed over. That is the right
 * way round for a system whose audit trail is a requirement rather than a
 * convenience.
 */
export function secretAccessRecorder(db: Database, ids: IdGenerator): SecretAccessRecorder {
  return {
    async record(access) {
      await db.insert(auditLog).values({
        id: ids.next(),
        occurredAt: new Date(),
        actorUserId: access.actor.userId === 'system' ? null : access.actor.userId,
        actorRoles: [...access.actor.roles],
        actorLabel: access.actor.label ?? null,
        action: 'clients.credential.read',
        entityType: access.entityType,
        entityId: access.entityId,
        before: null,
        // The label and the reason, never the secret. What goes in the log is
        // what somebody reading it later needs: which credential, and why.
        after: { label: access.label, reason: access.reason ?? null },
        ipAddress: access.actor.ipAddress ?? null,
        requestId: access.actor.requestId ?? null,
        sessionId: access.actor.sessionId ?? null,
      });
    },
  };
}
