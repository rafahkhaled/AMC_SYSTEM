import type { DocumentSummary } from '@amc/contracts';
import { documentUploadSchema } from '@amc/contracts';
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ReadClients } from '../application/read-clients.js';
import { ReceiveDocument } from '../application/receive-document.js';

/**
 * The largest a single document may be.
 *
 * A trade licence is a one-page PDF and a passport scan is a photograph. Ten
 * megabytes is generous for both and small enough that a mistaken upload of
 * something else is refused before it is read into memory rather than after.
 */
const MAX_BYTES = 10 * 1024 * 1024;

interface UploadedFileLike {
  readonly originalname: string;
  readonly mimetype: string;
  readonly buffer: Buffer;
  readonly size: number;
}

@Controller()
export class DocumentsController {
  constructor(
    @Inject(ReceiveDocument) private readonly documents: ReceiveDocument,
    @Inject(ReadClients) private readonly clients: ReadClients,
  ) {}

  /**
   * Receive a document for a client.
   *
   * Guarded on `clients.edit`, and then scoped again inside: holding the
   * permission does not make every client yours. The upload is refused before
   * the file is touched if the client is not in scope, so a rejected upload
   * cannot be used to learn that a company is on the firm's books.
   */
  @Post('clients/:clientId/documents')
  @RequirePermissions('clients.edit')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  async upload(
    @CurrentCaller() caller: Caller,
    @Param('clientId') clientId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() body: unknown,
  ): Promise<{ documentId: string; documents: DocumentSummary[] }> {
    if (!file) throw new BadRequestException('No file arrived with that upload');

    const parsed = documentUploadSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That upload is incomplete');
    }

    const client = await this.clients.detail(caller, clientId);
    if (!client) throw new NotFoundException('No such client');

    const outcome = await this.documents.execute(caller, {
      clientId,
      ...parsed.data,
      filename: file.originalname,
      contentType: file.mimetype,
      body: file.buffer,
    });
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);

    const updated = await this.clients.detail(caller, clientId);
    return { documentId: outcome.value.documentId, documents: updated?.documents ?? [] };
  }

  /**
   * Where to fetch a document from.
   *
   * A short-lived link rather than the bytes, so the file is served by
   * storage and this process is not the pipe every download flows through.
   * The link is minted per request and expires, so a copied URL stops working
   * long before it could be shared usefully.
   */
  @Get('documents/:id/link')
  async link(@CurrentCaller() caller: Caller, @Param('id') id: string): Promise<{ url: string }> {
    const url = await this.documents.linkTo(caller, id);
    if (!url) throw new NotFoundException('No such document');
    return { url };
  }
}
