import type { Database } from '@amc/database';
import type { DomainEvent } from '@amc/kernel';
import type { Notify } from '@amc/notifications';
import { sql } from 'drizzle-orm';

/**
 * Telling the managers that somebody asked for a consultation on the website.
 *
 * An enquiry from the website used to wait on the Enquiries board until
 * somebody happened to open it. A visitor who asked for a call this morning
 * should hear back this morning, so each manager gets a notification (and an
 * email, if they asked for those) the moment it is recorded.
 *
 * Only website enquiries: one typed in by a member of staff is already in front
 * of the person who typed it.
 */
export function enquiryNotifier(db: Database, notify: Notify) {
  return async (event: DomainEvent): Promise<void> => {
    const payload = event.payload as { leadId?: string; source?: string };
    if (payload.source !== 'website' || !payload.leadId) return;

    const [lead] = await db.execute<{
      name: string;
      email: string | null;
      phone: string | null;
      requested_service: string | null;
    }>(sql`SELECT name, email, phone, requested_service FROM leads WHERE id = ${payload.leadId}`);
    if (!lead) return;

    const managers = await db.execute<{ user_id: string }>(sql`
      SELECT u.id AS user_id FROM users u
      JOIN user_roles r ON r.user_id = u.id
      WHERE r.role = 'manager' AND u.status = 'active'
    `);

    const reach = [lead.phone, lead.email].filter(Boolean).join(' · ');
    const wanted = lead.requested_service ? ` — ${lead.requested_service}` : '';
    for (const manager of managers) {
      await notify.send({
        userId: manager.user_id,
        kind: 'new_enquiry',
        subjectType: 'lead',
        subjectId: payload.leadId,
        wording: {
          titleEn: `New enquiry from the website: ${lead.name}`,
          titleAr: `استفسار جديد من الموقع: ${lead.name}`,
          bodyEn: `${lead.name}${wanted}. ${reach}. It is on the Enquiries board.`,
          bodyAr: `${lead.name}${wanted}. ${reach}. تجده في لوحة الاستفسارات.`,
        },
      });
    }
  };
}
