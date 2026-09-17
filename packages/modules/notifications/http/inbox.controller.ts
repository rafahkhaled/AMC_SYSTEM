import type { Inbox, NotificationPreference } from '@amc/contracts';
import { choosePreferenceSchema } from '@amc/contracts';
import { type Caller, CurrentCaller } from '@amc/http-kit';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ReadInbox } from '../application/read-inbox.js';

/**
 * Somebody's own inbox (FR-43).
 *
 * Not permission-guarded, because there is no permission involved: everybody
 * has an inbox and nobody has anybody else's. The caller's own id is the whole
 * of the authorisation, and it is applied in the query rather than checked
 * afterwards.
 */
@Controller('notifications')
export class InboxController {
  constructor(@Inject(ReadInbox) private readonly inbox: ReadInbox) {}

  @Get()
  async list(@CurrentCaller() caller: Caller, @Query('unread') unread?: string): Promise<Inbox> {
    return this.inbox.forCaller(caller, { unreadOnly: unread === 'true' });
  }

  @Post(':id/read')
  async read(@CurrentCaller() caller: Caller, @Param('id') id: string): Promise<Inbox> {
    const found = await this.inbox.markRead(caller, id);
    // Somebody else's notification reads as not found, which is what it is.
    if (!found) throw new NotFoundException('No such notification');
    return this.inbox.forCaller(caller);
  }

  @Post('read-all')
  async readAll(@CurrentCaller() caller: Caller): Promise<Inbox> {
    await this.inbox.markAllRead(caller);
    return this.inbox.forCaller(caller);
  }

  @Get('preferences')
  async preferences(
    @CurrentCaller() caller: Caller,
  ): Promise<{ preferences: NotificationPreference[] }> {
    return { preferences: (await this.inbox.preferencesFor(caller)) as NotificationPreference[] };
  }

  @Put('preferences')
  async choose(
    @CurrentCaller() caller: Caller,
    @Body() body: unknown,
  ): Promise<{ preferences: NotificationPreference[] }> {
    const parsed = choosePreferenceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Which notification, and how?');

    const preferences = await this.inbox.choose(caller, parsed.data.kind, {
      inApp: parsed.data.inApp,
      email: parsed.data.email,
    });
    return { preferences: preferences as NotificationPreference[] };
  }
}
