import type { Inbox, NotificationPreference, NotificationView } from '@amc/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { InboxPage } from './inbox-page.js';

const inbox = vi.hoisted(() => vi.fn());
const markRead = vi.hoisted(() => vi.fn());
const markAllRead = vi.hoisted(() => vi.fn());
const preferences = vi.hoisted(() => vi.fn());
const choosePreference = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ inbox, markRead, markAllRead, preferences, choosePreference }));

function message(over: Partial<NotificationView> = {}): NotificationView {
  return {
    id: 'n-1',
    kind: 'escalation',
    subjectType: 'task',
    subjectId: 'task-1:client_reminder',
    clientId: 'c-1',
    titleEn: 'Gulf Trading LLC: chase the documents',
    titleAr: 'الخليج للتجارة: متابعة المستندات',
    bodyEn: 'The paperwork was asked for a week ago.',
    bodyAr: 'مضى أسبوع على طلب المستندات.',
    readAt: null,
    createdAt: '2026-09-17T06:00:00.000Z',
    ...over,
  };
}

const DEFAULTS: NotificationPreference[] = [
  { kind: 'document_expiring', inApp: true, email: false },
  { kind: 'deadline_near', inApp: true, email: true },
  { kind: 'task_assigned', inApp: true, email: false },
  { kind: 'escalation', inApp: true, email: true },
  { kind: 'time_needs_review', inApp: true, email: false },
];

function show(view: Partial<Inbox> = {}) {
  inbox.mockResolvedValue({ entries: [message()], unread: 1, ...view });
  preferences.mockResolvedValue(DEFAULTS);
  renderScreen(<InboxPage />);
}

describe('what somebody has been told (FR-43)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await useLanguage('en');
  });

  it('shows the message in the language being read', async () => {
    show();
    expect(await screen.findByText('Gulf Trading LLC: chase the documents')).toBeInTheDocument();
    expect(screen.getByText('The paperwork was asked for a week ago.')).toBeInTheDocument();
  });

  it('shows the Arabic wording that was stored, not a translation of it', async () => {
    /*
     * The wording is stored rather than keyed, because a notification is a
     * record of what somebody was told. Changing the translation file next
     * year must not change what the row says happened.
     */
    await useLanguage('ar');
    show();

    expect(await screen.findByText('الخليج للتجارة: متابعة المستندات')).toBeInTheDocument();
    expect(screen.queryByText('Gulf Trading LLC: chase the documents')).not.toBeInTheDocument();
  });

  it('marks an unread message so it can be picked out', async () => {
    show();
    await screen.findByText('Gulf Trading LLC: chase the documents');
    expect(document.querySelectorAll('.message--unread')).toHaveLength(1);
  });

  it('offers nothing to read on a message already read', async () => {
    show({ entries: [message({ readAt: '2026-09-17T07:00:00.000Z' })], unread: 0 });
    await screen.findByText('Gulf Trading LLC: chase the documents');
    expect(screen.queryByRole('button', { name: 'Mark read' })).not.toBeInTheDocument();
  });

  it('marks one read', async () => {
    const user = userEvent.setup();
    show();
    markRead.mockResolvedValue({ entries: [message({ readAt: 'now' })], unread: 0 });

    await user.click(await screen.findByRole('button', { name: 'Mark read' }));

    expect(markRead.mock.calls[0]?.[0]).toBe('n-1');
  });

  it('marks everything read in one go, and says how many', async () => {
    const user = userEvent.setup();
    show({ entries: [message(), message({ id: 'n-2' })], unread: 2 });
    markAllRead.mockResolvedValue({ entries: [], unread: 0 });

    await user.click(await screen.findByRole('button', { name: 'Mark all 2 as read' }));

    expect(markAllRead).toHaveBeenCalled();
  });

  it('offers nothing to clear when nothing is unread', async () => {
    show({ entries: [message({ readAt: 'now' })], unread: 0 });
    await screen.findByText('Gulf Trading LLC: chase the documents');
    expect(screen.queryByRole('button', { name: /Mark all/ })).not.toBeInTheDocument();
  });

  it('says the inbox is quiet rather than showing an empty box', async () => {
    show({ entries: [], unread: 0 });
    expect(await screen.findByText('Nothing to tell you')).toBeInTheDocument();
  });

  it('lists every kind of notification, chosen or not', async () => {
    /*
     * A settings screen showing only what somebody has already changed is one
     * where the untouched settings are invisible.
     */
    const user = userEvent.setup();
    show();

    // The tabs are buttons, not ARIA tabs. Asking for a role that is not
    // there costs a one-second timeout before the fallback runs.
    await user.click(await screen.findByRole('button', { name: 'Settings' }));

    expect(await screen.findByText('A chase has escalated')).toBeInTheDocument();
    expect(screen.getByText('A document is expiring')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(6);
  });

  it('turns one kind of email off without touching the rest', async () => {
    const user = userEvent.setup();
    show();
    choosePreference.mockResolvedValue(DEFAULTS);

    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    await screen.findByText('A chase has escalated');

    const escalation = screen.getAllByRole('row')[4];
    const email = escalation?.querySelectorAll('input[type=checkbox]')[1];
    await user.click(email as HTMLElement);

    // React Query hands the mutation its own context as a second argument,
    // which this one ignores. The preference is what matters.
    expect(choosePreference.mock.calls[0]?.[0]).toEqual({
      kind: 'escalation',
      inApp: true,
      email: false,
    });
  });
});
