import type { WhatsAppConversations, WhatsAppThread } from '@amc/contracts';
import { identifyConversationRequestSchema, sendWhatsAppRequestSchema } from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ReadConversations } from '../application/read-conversations.js';
import { SendMessage } from '../application/send-message.js';

/**
 * The staff side of WhatsApp (PW-08).
 *
 * Reads are scoped and not permission-guarded: `clients.view.all` and
 * `clients.view.assigned` belong to different roles, so naming either here
 * would lock the other out. Writes are guarded, because for those there is one
 * permission and no alternative — writing to a client on the practice's behalf
 * is `clients.edit`, the same permission as changing their record, because it
 * is the same kind of act.
 */
@Controller('whatsapp')
export class WhatsAppController {
  constructor(
    @Inject(ReadConversations) private readonly conversations: ReadConversations,
    @Inject(SendMessage) private readonly send: SendMessage,
  ) {}

  @Get('conversations')
  async list(@CurrentCaller() caller: Caller): Promise<WhatsAppConversations> {
    return this.conversations.list(caller);
  }

  @Get('conversations/:id')
  async thread(@CurrentCaller() caller: Caller, @Param('id') id: string): Promise<WhatsAppThread> {
    const thread = await this.conversations.thread(caller, id);
    // Out of scope and not there answer alike. A 403 would confirm that a
    // conversation with this id exists, which is the thing being withheld.
    if (!thread) throw new NotFoundException('No such conversation');
    return thread;
  }

  @RequirePermissions('clients.edit')
  @Post('conversations/:id/messages')
  async reply(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<WhatsAppThread> {
    const parsed = sendWhatsAppRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Say something to send');

    const sent = await this.send.asPerson(caller, { conversationId: id, body: parsed.data.body });
    /*
     * A refusal here is usually the twenty-four hour window, which is Meta's
     * rule and not a bug. It reaches the screen as its own message so the
     * person can see why the box is closed rather than watching a send fail
     * silently.
     */
    if (!sent.ok) throw new ConflictException(sent.error.message);

    return this.mustRead(caller, id);
  }

  @RequirePermissions('clients.edit')
  @Post('conversations/:id/take-over')
  async takeOver(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
  ): Promise<WhatsAppThread> {
    const taken = await this.send.takeOver(caller, id);
    if (!taken.ok) throw new ConflictException(taken.error.message);
    return this.mustRead(caller, id);
  }

  @RequirePermissions('clients.edit')
  @Post('conversations/:id/hand-back')
  async handBack(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
  ): Promise<WhatsAppThread> {
    const handed = await this.send.handBack(caller, id);
    if (!handed.ok) throw new ConflictException(handed.error.message);
    return this.mustRead(caller, id);
  }

  /**
   * Saying whose number an unmatched conversation belongs to.
   *
   * The one thing on this screen that changes a client's record rather than
   * the conversation, which is why it is guarded by `clients.edit` and audited
   * through the aggregate's own event rather than done quietly.
   */
  @RequirePermissions('clients.edit')
  @Post('conversations/:id/identify')
  @HttpCode(HttpStatus.OK)
  async identify(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<WhatsAppThread> {
    const parsed = identifyConversationRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Name the client');

    const identified = await this.send.identify(
      caller,
      id,
      parsed.data.clientId,
      parsed.data.contactId,
    );
    if (!identified.ok) throw new ConflictException(identified.error.message);

    return this.mustRead(caller, id);
  }

  /**
   * The thread after a change, so the screen never has to guess what happened.
   *
   * Returning the new state rather than 204 is what stops the browser keeping
   * its own copy of the window clock, the handling state and the delivery
   * status — three things it would get wrong within a day.
   */
  private async mustRead(caller: Caller, id: string): Promise<WhatsAppThread> {
    const thread = await this.conversations.thread(caller, id);
    if (!thread) throw new NotFoundException('No such conversation');
    return thread;
  }
}
