import type { Database } from '@amc/database';
import type { EscalationStage } from '@amc/deadlines/domain';
import type { Notify } from '@amc/notifications';
import { sql } from 'drizzle-orm';

export interface EscalationNotifier {
  tell(params: { taskId: string; clientId: string; stage: EscalationStage }): Promise<void>;
}

/**
 * Who each rung of the ladder is for (FR-43).
 *
 * The client reminder and the accountant alert both go to whoever is on the
 * task, because it is the accountant who chases the client — the system does
 * not email clients directly, and should not start doing so without somebody
 * deciding that deliberately. The manager alert goes to the managers.
 */
const AUDIENCE: Readonly<Record<EscalationStage, 'assigned' | 'managers'>> = {
  client_reminder: 'assigned',
  accountant_alert: 'assigned',
  manager_alert: 'managers',
};

/** The words, in both languages, as they will be stored. */
function wordingFor(stage: EscalationStage, client: string, service: string) {
  const en = {
    client_reminder: {
      titleEn: `${client}: chase the documents`,
      bodyEn: `The paperwork for ${service} was asked for a week ago and has not arrived. Follow it up with the client.`,
    },
    accountant_alert: {
      titleEn: `${client}: still waiting after two weeks`,
      bodyEn: `${service} is still waiting on documents fourteen days after they were requested.`,
    },
    manager_alert: {
      titleEn: `${client}: deadline approaching without documents`,
      bodyEn: `${service} is close to its deadline and the documents are still outstanding.`,
    },
  }[stage];

  const ar = {
    client_reminder: {
      titleAr: `${client}: متابعة المستندات`,
      bodyAr: `مضى أسبوع على طلب مستندات ${service} ولم تصل بعد. تابع مع العميل.`,
    },
    accountant_alert: {
      titleAr: `${client}: لا تزال المستندات متأخّرة بعد أسبوعين`,
      bodyAr: `مضى أربعة عشر يومًا على طلب مستندات ${service} ولم تصل.`,
    },
    manager_alert: {
      titleAr: `${client}: اقترب الموعد والمستندات ناقصة`,
      bodyAr: `اقترب الموعد النهائي لـ ${service} ولا تزال المستندات ناقصة.`,
    },
  }[stage];

  return { ...en, ...ar };
}

/**
 * Turns a rung into notifications for the right people.
 *
 * Lives in the worker rather than in either module, because it joins the
 * escalation ladder to the people who should hear about it, and neither owns
 * the other.
 */
export function escalationNotifier(db: Database, notify: Notify): EscalationNotifier {
  return {
    async tell({ taskId, clientId, stage }) {
      const [task] = await db.execute<{ service: string; client_name: string }>(sql`
        SELECT t.service, c.legal_name AS client_name
        FROM tasks t JOIN clients c ON c.id = t.client_id
        WHERE t.id = ${taskId}
      `);
      if (!task) return;

      const recipients =
        AUDIENCE[stage] === 'managers'
          ? await db.execute<{ user_id: string }>(sql`
              SELECT u.id AS user_id FROM users u
              JOIN user_roles r ON r.user_id = u.id
              WHERE r.role = 'manager' AND u.status = 'active'
            `)
          : await db.execute<{ user_id: string }>(sql`
              SELECT a.user_id FROM task_assignments a
              JOIN users u ON u.id = a.user_id
              WHERE a.task_id = ${taskId} AND a.unassigned_at IS NULL AND u.status = 'active'
            `);

      const wording = wordingFor(stage, task.client_name, task.service);
      for (const recipient of recipients) {
        await notify.send({
          userId: recipient.user_id,
          kind: 'escalation',
          subjectType: 'task',
          // The stage is part of what this is about, so a later rung is a
          // different notification rather than a duplicate of the first.
          subjectId: `${taskId}:${stage}`,
          clientId,
          wording,
        });
      }
    },
  };
}
