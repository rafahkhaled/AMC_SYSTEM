import {
  type WhatsAppConversationView,
  type WhatsAppThread,
  whatsappConversationsSchema,
  whatsappThreadSchema,
} from '@amc/contracts';
import { request, send } from '../auth/api.js';

export async function conversations(): Promise<WhatsAppConversationView[]> {
  return whatsappConversationsSchema.parse(await request('/whatsapp/conversations')).conversations;
}

export async function thread(id: string): Promise<WhatsAppThread> {
  return whatsappThreadSchema.parse(
    await request(`/whatsapp/conversations/${encodeURIComponent(id)}`),
  );
}

/**
 * Every write answers with the whole thread.
 *
 * So the screen never keeps its own copy of the window clock, who is handling
 * the conversation, or a message's delivery state — three things it would get
 * wrong within a day, and the first of which decides whether the reply box is
 * usable at all.
 */
export async function reply(id: string, body: string): Promise<WhatsAppThread> {
  return whatsappThreadSchema.parse(
    await send(`/whatsapp/conversations/${encodeURIComponent(id)}/messages`, { body }),
  );
}

export async function takeOver(id: string): Promise<WhatsAppThread> {
  return whatsappThreadSchema.parse(
    await send(`/whatsapp/conversations/${encodeURIComponent(id)}/take-over`),
  );
}

export async function handBack(id: string): Promise<WhatsAppThread> {
  return whatsappThreadSchema.parse(
    await send(`/whatsapp/conversations/${encodeURIComponent(id)}/hand-back`),
  );
}

export async function identify(
  id: string,
  clientId: string,
  contactId?: string,
): Promise<WhatsAppThread> {
  return whatsappThreadSchema.parse(
    await send(
      `/whatsapp/conversations/${encodeURIComponent(id)}/identify`,
      contactId ? { clientId, contactId } : { clientId },
    ),
  );
}
