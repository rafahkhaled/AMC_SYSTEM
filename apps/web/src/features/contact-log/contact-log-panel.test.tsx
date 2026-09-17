import type { ContactLogEntryView } from '@amc/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { ContactLogPanel } from './contact-log-panel.js';

const contactLog = vi.hoisted(() => vi.fn());
const recordContact = vi.hoisted(() => vi.fn());
const attachmentLink = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ contactLog, recordContact, attachmentLink }));

function entry(over: Partial<ContactLogEntryView> = {}): ContactLogEntryView {
  return {
    id: 'entry-1',
    channel: 'call',
    direction: 'outbound',
    // 10:00 UTC is two in the afternoon in Dubai.
    happenedAt: '2026-09-14T10:00:00.000Z',
    summary: 'Asked Ahmed for the renewed trade licence. Said Sunday.',
    taskId: null,
    attachments: [],
    ...over,
  };
}

function show(entries: ContactLogEntryView[] = [entry()]) {
  contactLog.mockResolvedValue(entries);
  renderScreen(<ContactLogPanel clientId="c-1" />);
}

/** Opens the form and fills in everything required. */
async function fillIn(user: ReturnType<typeof userEvent.setup>, summary = 'Chased the licence') {
  await user.click(await screen.findByRole('button', { name: 'Record a conversation' }));
  await user.type(screen.getByLabelText('When it happened'), '2026-09-14T14:00');
  if (summary) await user.type(screen.getByLabelText('What was said'), summary);
}

describe('what was said to a client (FR-06)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await useLanguage('en');
  });

  it('reads the time in Dubai, whatever the machine thinks', async () => {
    // The person reading this works there. A server in London would otherwise
    // show the conversation as having happened in the morning.
    show();
    expect(await screen.findByText('14 Sept 2026, 14:00')).toBeInTheDocument();
  });

  it('says which way the conversation went', async () => {
    // Whether we chased them or they came to us is the difference between a
    // client who is slow and one who is asking questions.
    show([entry({ direction: 'inbound' })]);
    expect(await screen.findByText('They contacted us')).toBeInTheDocument();
  });

  it('keeps the line breaks somebody typed', async () => {
    show([entry({ summary: 'Line one.\nLine two.' })]);
    const body = await screen.findByText(/Line one/);
    expect(body).toHaveClass('contact-entry__summary');
    expect(body.textContent).toBe('Line one.\nLine two.');
  });

  it('lists the screenshots, because they are what prove the request', async () => {
    show([
      entry({
        channel: 'whatsapp',
        attachments: [
          { id: 'a-1', name: 'thread-1.png', contentType: 'image/png', sizeBytes: 900 },
          { id: 'a-2', name: 'thread-2.png', contentType: 'image/png', sizeBytes: 900 },
        ],
      }),
    ]);

    expect(await screen.findByRole('button', { name: 'thread-1.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'thread-2.png' })).toBeInTheDocument();
  });

  it('fetches a screenshot’s link only when it is wanted', async () => {
    /*
     * One link per attachment on page load would start expiring the moment the
     * page opened, and most would never be used.
     */
    const user = userEvent.setup();
    show([
      entry({
        attachments: [{ id: 'a-1', name: 'thread.png', contentType: 'image/png', sizeBytes: 900 }],
      }),
    ]);
    attachmentLink.mockResolvedValue('/api/files/whatever');
    vi.stubGlobal('open', vi.fn());

    await screen.findByRole('button', { name: 'thread.png' });
    expect(attachmentLink).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'thread.png' }));
    expect(attachmentLink).toHaveBeenCalledWith('c-1', 'a-1');
    vi.unstubAllGlobals();
  });

  it('will not record a conversation that says nothing', async () => {
    const user = userEvent.setup();
    show([]);

    await fillIn(user, '');

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('will not record one with no time', async () => {
    const user = userEvent.setup();
    show([]);

    await user.click(await screen.findByRole('button', { name: 'Record a conversation' }));
    await user.type(screen.getByLabelText('What was said'), 'Chased the licence');

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('asks for the time it happened, not the time it is typed up', async () => {
    // A call on Tuesday written up on Thursday is a call on Tuesday, and the
    // chase counts days from the former.
    const user = userEvent.setup();
    show([]);

    await user.click(await screen.findByRole('button', { name: 'Record a conversation' }));

    expect(
      screen.getByText('The time of the call itself, not the time you are typing it up.'),
    ).toBeInTheDocument();
  });

  it('sends what was typed, with no screenshot for a phone call', async () => {
    const user = userEvent.setup();
    show([]);
    recordContact.mockResolvedValue([entry()]);

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(recordContact).toHaveBeenCalledWith(
      'c-1',
      {
        channel: 'call',
        direction: 'outbound',
        happenedAt: '2026-09-14T14:00',
        summary: 'Chased the licence',
      },
      [],
    );
  });

  it('shows the refusal the server gave', async () => {
    const user = userEvent.setup();
    show([]);
    recordContact.mockRejectedValue(new Error('That conversation has not happened yet'));

    await fillIn(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('That conversation has not happened yet')).toBeInTheDocument();
  });

  it('says why an empty log matters, rather than just that it is empty', async () => {
    show([]);
    expect(
      await screen.findByText(
        'Record every call and message: the chase counts days from the first request.',
      ),
    ).toBeInTheDocument();
  });
});
