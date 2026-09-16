import type { ContactLogEntryView } from '@amc/contracts';
import { recordContactSchema } from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions } from '@amc/http-kit';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ContactLog } from '../application/contact-log.js';

/** A WhatsApp thread is several images; a phone call is none. */
const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;

interface UploadedFileLike {
  readonly originalname: string;
  readonly mimetype: string;
  readonly buffer: Buffer;
}

/**
 * What was said to a client, and the screenshots that prove it (FR-06).
 *
 * Reading is scoped rather than permission-guarded, like the rest of the
 * client screens: the two view permissions are alternatives, so naming either
 * would lock out a role. Writing needs `clients.edit`.
 */
@Controller('clients/:clientId/contact-log')
export class ContactLogController {
  constructor(@Inject(ContactLog) private readonly log: ContactLog) {}

  @Get()
  async list(
    @CurrentCaller() caller: Caller,
    @Param('clientId') clientId: string,
  ): Promise<{ entries: ContactLogEntryView[] }> {
    return { entries: (await this.log.forClient(caller, clientId)) as ContactLogEntryView[] };
  }

  @Post()
  @RequirePermissions('clients.edit')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, { limits: { fileSize: MAX_BYTES, files: MAX_FILES } }),
  )
  async record(
    @CurrentCaller() caller: Caller,
    @Param('clientId') clientId: string,
    @UploadedFiles() files: UploadedFileLike[] | undefined,
    @Body() body: unknown,
  ): Promise<{ entries: ContactLogEntryView[] }> {
    const parsed = recordContactSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That entry is incomplete');
    }

    const outcome = await this.log.record(caller, {
      clientId,
      ...parsed.data,
      // Wall clock with no zone, read on the clock the person was looking at.
      happenedAt: new Date(`${parsed.data.happenedAt}:00+04:00`),
      files: (files ?? []).map((file) => ({
        filename: file.originalname,
        contentType: file.mimetype,
        body: file.buffer,
      })),
    });
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);

    return { entries: (await this.log.forClient(caller, clientId)) as ContactLogEntryView[] };
  }

  @Get('attachments/:attachmentId/link')
  async link(
    @CurrentCaller() caller: Caller,
    @Param('clientId') clientId: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<{ url: string }> {
    const url = await this.log.linkTo(caller, clientId, attachmentId);
    if (!url) throw new NotFoundException('No such attachment');
    return { url };
  }
}
