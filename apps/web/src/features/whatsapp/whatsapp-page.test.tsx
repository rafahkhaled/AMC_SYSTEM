import type { WhatsAppConversationView, WhatsAppMessageView, WhatsAppThread } from '@amc/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, useLanguage } from '../../test-support.js';
import { WhatsAppPage } from './whatsapp-page.js';

const conversations = vi.hoisted(() => vi.fn());
const thread = vi.hoisted(() => vi.fn());
const reply = vi.hoisted(() => vi.fn());
const takeOver = vi.hoisted(() => vi.fn());
const handBack = vi.hoisted(() => vi.fn());
const identify = vi.hoisted(() => vi.fn());
vi.mock('./api.js', () => ({ conversations, thread, reply, takeOver, handBack, identify }));

function conversation(over: Partial<WhatsAppConversationView> = {}): WhatsAppConversationView {
  return {
    id: 'wc-1',
    phone: '+971501234567',
    phoneFormatted: '+971 50 123 4567',
    clientId: 'demo-gulf',
    clientName: 'Gulf Trading LLC',
    contactId: 'k-1',
    contactName: 'Layla Hassan',
    profileName: 'Layla',
    language: 'ar',
    handling: 'bot',
    assignedUserId: null,
    assignedName: null,
    optedOut: false,
    windowOpen: true,
    windowClosesAt: '2026-09-22T08:00:00.000Z',
    lastInboundAt: '2026-09-21T08:00:00.000Z',
    lastOutboundAt: null,
    unreadFromClient: 0,
    createdAt: '2026-09-18T08:00:00.000Z',
    ...over,
  };
}

function message(over: Partial<WhatsAppMessageView> = {}): WhatsAppMessageView {
  return {
    id: 'wm-1',
    direction: 'inbound',
    kind: 'text',
    body: 'متى موعد الإقرار؟',
    templateName: null,
    documentId: null,
    mediaFilename: null,
    status: 'received',
    failureReason: null,
    sentByUserId: null,
    sentByName: null,
    occurredAt: '2026-09-21T08:00:00.000Z',
    ...over,
  };
}

function threadOf(
  over: Partial<WhatsAppConversationView> = {},
  messages: WhatsAppMessageView[] = [message()],
): WhatsAppThread {
  return { conversation: conversation(over), messages };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await useLanguage('en');
  conversations.mockResolvedValue([conversation()]);
  thread.mockResolvedValue(threadOf());
});

describe('the conversation list', () => {
  it('names the client rather than showing a phone number alone', async () => {
    renderScreen(<WhatsAppPage />);
    expect(await screen.findByText('Gulf Trading LLC')).toBeInTheDocument();
    expect(screen.getByText('+971 50 123 4567')).toBeInTheDocument();
  });

  it('falls back to the WhatsApp profile name when there is no client', async () => {
    conversations.mockResolvedValue([
      conversation({ clientId: null, clientName: null, profileName: 'Layla' }),
    ]);
    renderScreen(<WhatsAppPage />);
    expect(await screen.findByText('Layla')).toBeInTheDocument();
  });

  it('marks a number nobody has matched, because that is work for somebody', async () => {
    conversations.mockResolvedValue([conversation({ clientId: null, clientName: null })]);
    renderScreen(<WhatsAppPage />);
    expect(await screen.findByText('Unknown number')).toBeInTheDocument();
  });

  it('says how many messages are still owed an answer', async () => {
    conversations.mockResolvedValue([conversation({ unreadFromClient: 3 })]);
    renderScreen(<WhatsAppPage />);
    expect(await screen.findByText('3 waiting')).toBeInTheDocument();
  });

  it('names the person holding a conversation, not merely that somebody is', async () => {
    conversations.mockResolvedValue([
      conversation({ handling: 'human', assignedUserId: 'u-1', assignedName: 'Hana Saeed' }),
    ]);
    renderScreen(<WhatsAppPage />);
    // "With a person" tells nobody whether to pick it up themselves.
    expect(await screen.findByText('Hana Saeed')).toBeInTheDocument();
  });

  it('says so when there is nothing yet', async () => {
    conversations.mockResolvedValue([]);
    renderScreen(<WhatsAppPage />);
    expect(await screen.findByText('No conversations yet')).toBeInTheDocument();
  });

  it('reports a failure rather than showing an empty list', async () => {
    conversations.mockRejectedValue(new Error('nope'));
    renderScreen(<WhatsAppPage />);
    expect(await screen.findByText('The conversations could not be loaded.')).toBeInTheDocument();
  });
});

describe('opening a thread', () => {
  it('shows what was said, in both directions', async () => {
    thread.mockResolvedValue(
      threadOf({}, [
        message(),
        message({
          id: 'wm-2',
          direction: 'outbound',
          body: 'Your VAT return was due 28 August.',
          status: 'sent',
        }),
      ]),
    );

    renderScreen(<WhatsAppPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));

    expect(await screen.findByText('متى موعد الإقرار؟')).toBeInTheDocument();
    expect(screen.getByText('Your VAT return was due 28 August.')).toBeInTheDocument();
  });

  it('says which outbound messages the bot sent', async () => {
    thread.mockResolvedValue(
      threadOf({}, [message({ direction: 'outbound', body: 'Received.', status: 'sent' })]),
    );

    renderScreen(<WhatsAppPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));

    /*
     * Scoped to the bubble, because the same words appear on the row behind
     * it: a conversation the bot is handling is labelled the same way as a
     * message the bot sent, and an unscoped query matches both and throws.
     */
    const bubble = await screen.findByText('Received.');
    expect(bubble.closest('li')).toHaveTextContent('Answered automatically');
  });

  it('shows a message that was not delivered as not delivered', async () => {
    thread.mockResolvedValue(
      threadOf({}, [
        message({
          direction: 'outbound',
          body: 'Any news?',
          status: 'failed',
          failureReason: 'Not a WhatsApp number',
        }),
      ]),
    );

    renderScreen(<WhatsAppPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));
    expect(await screen.findByText(/Not delivered/)).toBeInTheDocument();
  });
});

describe("the twenty-four hour window, which is Meta's rule", () => {
  it('offers a reply box while the window is open', async () => {
    renderScreen(<WhatsAppPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));
    expect(await screen.findByLabelText('Reply')).toBeInTheDocument();
  });

  it('explains itself when the window has shut, rather than going quiet', async () => {
    thread.mockResolvedValue(threadOf({ windowOpen: false }));

    renderScreen(<WhatsAppPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));

    /*
     * Somebody who sees a missing box with no reason assumes the system is
     * broken and sends it from their own phone — which is the habit this
     * screen exists to replace.
     */
    expect(await screen.findByText(/More than 24 hours/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Reply')).not.toBeInTheDocument();
  });

  it('takes the answer from the server and never works it out here', async () => {
    // lastInboundAt is days old, and the server still says the window is open.
    // The screen must believe the server: it is the one that will refuse.
    thread.mockResolvedValue(threadOf({ windowOpen: true, lastInboundAt: '2026-01-01T00:00:00Z' }));

    renderScreen(<WhatsAppPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));
    expect(await screen.findByLabelText('Reply')).toBeInTheDocument();
  });
});

describe('writing to a client', () => {
  it('sends what was typed and clears the box', async () => {
    reply.mockResolvedValue(
      threadOf({}, [message(), message({ id: 'wm-2', direction: 'outbound', body: 'On it.' })]),
    );

    renderScreen(<WhatsAppPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));

    const box = await screen.findByLabelText('Reply');
    await userEvent.type(box, 'On it.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(reply).toHaveBeenCalledWith('wc-1', 'On it.'));
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('will not send an empty message', async () => {
    renderScreen(<WhatsAppPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));

    await screen.findByLabelText('Reply');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('shows what the server said when it refuses', async () => {
    reply.mockRejectedValue(new Error('This client has not written in the last 24 hours'));

    renderScreen(<WhatsAppPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));

    await userEvent.type(await screen.findByLabelText('Reply'), 'Any news?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/has not written in the last 24 hours/)).toBeInTheDocument();
  });
});

describe('taking a conversation over', () => {
  it('offers to take it while the bot is answering', async () => {
    takeOver.mockResolvedValue(
      threadOf({ handling: 'human', assignedUserId: 'u-1', assignedName: 'Hana Saeed' }),
    );

    renderScreen(<WhatsAppPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Take it over' }));

    await waitFor(() => expect(takeOver).toHaveBeenCalledWith('wc-1'));
    // And then offers the opposite, rather than offering to take it twice.
    expect(await screen.findByRole('button', { name: 'Hand it back to the bot' })).toBeVisible();
  });

  it('offers to hand it back once somebody holds it', async () => {
    thread.mockResolvedValue(
      threadOf({ handling: 'human', assignedUserId: 'u-1', assignedName: 'Hana Saeed' }),
    );
    handBack.mockResolvedValue(threadOf({ handling: 'bot' }));

    renderScreen(<WhatsAppPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Hand it back to the bot' }));

    await waitFor(() => expect(handBack).toHaveBeenCalledWith('wc-1'));
  });
});

describe('a conversation nobody has matched to a client', () => {
  it('says what cannot happen until somebody does', async () => {
    // Both mocks, not only the thread: the row is drawn from the list.
    conversations.mockResolvedValue([conversation({ clientId: null, clientName: null })]);
    thread.mockResolvedValue(threadOf({ clientId: null, clientName: null }));

    renderScreen(<WhatsAppPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Layla/ }));

    expect(await screen.findByText(/not attached to a client/)).toBeInTheDocument();
  });

  it('warns that a client asked for no automatic messages', async () => {
    thread.mockResolvedValue(threadOf({ optedOut: true }));

    renderScreen(<WhatsAppPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Gulf Trading LLC/ }));

    // Staff may still write; the bot may not. Saying so stops somebody
    // wondering why the client stopped getting reminders.
    expect(await screen.findByText(/asked for no automatic messages/)).toBeInTheDocument();
    expect(await screen.findByLabelText('Reply')).toBeInTheDocument();
  });
});

describe('in Arabic', () => {
  it('reads right through, including the menu item', async () => {
    await useLanguage('ar');
    renderScreen(<WhatsAppPage />);
    expect(await screen.findByText('محادثات واتساب')).toBeInTheDocument();
  });
});
