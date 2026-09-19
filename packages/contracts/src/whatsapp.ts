import { z } from 'zod';

/** Who is answering a conversation. */
export const whatsappHandling = ['bot', 'human', 'closed'] as const;

export const whatsappMessageSchema = z.object({
  id: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  kind: z.string(),
  body: z.string().nullable(),
  /** The approved template used, when one was. */
  templateName: z.string().nullable(),
  /** The client document an attachment became, once it was filed. */
  documentId: z.string().nullable(),
  mediaFilename: z.string().nullable(),
  status: z.string(),
  failureReason: z.string().nullable(),
  /**
   * Who sent it. Null on an outbound message means the bot did, which is the
   * question somebody asks when they want to know what the client was told
   * without anybody looking.
   */
  sentByUserId: z.string().nullable(),
  sentByName: z.string().nullable(),
  occurredAt: z.string(),
});
export type WhatsAppMessageView = z.infer<typeof whatsappMessageSchema>;

export const whatsappConversationSchema = z.object({
  id: z.string(),
  /** E.164, as stored. */
  phone: z.string(),
  /** Grouped for reading: +971 50 123 4567. */
  phoneFormatted: z.string(),
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
  contactId: z.string().nullable(),
  contactName: z.string().nullable(),
  profileName: z.string().nullable(),
  language: z.enum(['en', 'ar']),
  handling: z.enum(whatsappHandling),
  assignedUserId: z.string().nullable(),
  assignedName: z.string().nullable(),
  optedOut: z.boolean(),
  /**
   * Whether free text may be sent right now.
   *
   * Sent to the browser rather than worked out there, because it is Meta's rule
   * and the browser would have to reimplement it — and a disabled reply box
   * that disagrees with the server is worse than none.
   */
  windowOpen: z.boolean(),
  windowClosesAt: z.string().nullable(),
  lastInboundAt: z.string().nullable(),
  lastOutboundAt: z.string().nullable(),
  unreadFromClient: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type WhatsAppConversationView = z.infer<typeof whatsappConversationSchema>;

export const whatsappConversationsSchema = z.object({
  conversations: z.array(whatsappConversationSchema),
});
export type WhatsAppConversations = z.infer<typeof whatsappConversationsSchema>;

export const whatsappThreadSchema = z.object({
  conversation: whatsappConversationSchema,
  messages: z.array(whatsappMessageSchema),
});
export type WhatsAppThread = z.infer<typeof whatsappThreadSchema>;

export const sendWhatsAppRequestSchema = z.object({
  body: z.string().trim().min(1).max(4096),
});
export type SendWhatsAppRequest = z.infer<typeof sendWhatsAppRequestSchema>;

export const identifyConversationRequestSchema = z.object({
  clientId: z.string().min(1),
  contactId: z.string().min(1).optional(),
});
export type IdentifyConversationRequest = z.infer<typeof identifyConversationRequestSchema>;
