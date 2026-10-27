import type { Database } from '@amc/database';
import { describe, expect, it, vi } from 'vitest';
import { enquiryNotifier } from './notify-enquiry.js';

/** A database that answers the two questions the alert asks, in order. */
function fakeDb(lead: Record<string, unknown> | null, managers: string[]): Database {
  const answers = [lead ? [lead] : [], managers.map((id) => ({ user_id: id }))];
  return { execute: vi.fn(async () => answers.shift() ?? []) } as unknown as Database;
}

const captured = (payload: Record<string, unknown>) => ({
  name: 'clients.lead.captured',
  aggregateId: 'lead-1',
  occurredAt: new Date('2026-10-27T08:00:00Z'),
  payload,
});

describe('an enquiry from the website', () => {
  it('tells every manager, with who it is and how to reach them', async () => {
    const send = vi.fn(async (_command: Record<string, unknown>) => 'sent' as const);
    const handle = enquiryNotifier(
      fakeDb(
        {
          name: 'Mariam',
          email: 'mariam@gulf.example',
          phone: '050 123 4567',
          requested_service: 'Auditing',
        },
        ['m-1', 'm-2'],
      ),
      { send } as never,
    );

    await handle(captured({ leadId: 'lead-1', source: 'website' }) as never);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      userId: 'm-1',
      kind: 'new_enquiry',
      subjectType: 'lead',
      subjectId: 'lead-1',
      wording: {
        titleEn: 'New enquiry from the website: Mariam',
        titleAr: 'استفسار جديد من الموقع: Mariam',
      },
    });
    expect((send.mock.calls[0]?.[0] as { wording: { bodyEn: string } }).wording.bodyEn).toContain(
      '050 123 4567',
    );
  });

  it('says nothing about one a member of staff typed in', async () => {
    const send = vi.fn();
    const db = fakeDb({ name: 'X' }, ['m-1']);
    await enquiryNotifier(db, { send } as never)(
      captured({ leadId: 'lead-1', source: 'phone' }) as never,
    );
    expect(send).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('does nothing when the enquiry is no longer there', async () => {
    const send = vi.fn();
    await enquiryNotifier(fakeDb(null, ['m-1']), { send } as never)(
      captured({ leadId: 'gone', source: 'website' }) as never,
    );
    expect(send).not.toHaveBeenCalled();
  });
});
