import {
  type ClientFilesUploaded,
  type ClientFolderView,
  createFolderSchema,
  moveFileSchema,
  renameFolderSchema,
} from '@amc/contracts';
import { type Caller, CurrentCaller, RequirePermissions, decodeUploadName } from '@amc/http-kit';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ClientFiles } from '../application/client-files.js';
import { ReadClients } from '../application/read-clients.js';

/**
 * Per file, and per upload.
 *
 * Twenty-five megabytes is the most the document store takes in one object, so
 * a bigger limit here would only move the refusal to somewhere less helpful.
 * Ten at a time is what somebody drags in from a folder of statements; more
 * than that is better done in two goes than held in memory at once.
 */
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;

interface UploadedFileLike {
  readonly originalname: string;
  readonly mimetype: string;
  readonly buffer: Buffer;
}

/**
 * The folder every client has.
 *
 * Reading follows the client's own scope, like the document list. Writing is
 * `clients.edit`, and then scoped again inside: holding the permission does
 * not make every client yours.
 */
@Controller()
export class ClientFilesController {
  constructor(
    @Inject(ClientFiles) private readonly files: ClientFiles,
    @Inject(ReadClients) private readonly clients: ReadClients,
  ) {}

  @Get('clients/:clientId/files')
  async list(
    @CurrentCaller() caller: Caller,
    @Param('clientId') clientId: string,
  ): Promise<{ files: Awaited<ReturnType<ClientFiles['list']>> }> {
    return { files: await this.files.list(caller, clientId) };
  }

  @Post('clients/:clientId/files')
  @RequirePermissions('clients.edit')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, { limits: { fileSize: MAX_BYTES, files: MAX_FILES } }),
  )
  async upload(
    @CurrentCaller() caller: Caller,
    @Param('clientId') clientId: string,
    @UploadedFiles() uploaded: UploadedFileLike[] | undefined,
    @Body() fields: { folderId?: string } | undefined,
  ): Promise<ClientFilesUploaded> {
    if (!uploaded || uploaded.length === 0) {
      throw new BadRequestException('No file arrived with that upload');
    }

    const client = await this.clients.detail(caller, clientId);
    if (!client) throw new NotFoundException('No such client');

    const outcome = await this.files.upload(
      caller,
      clientId,
      uploaded.map((file) => ({
        filename: decodeUploadName(file.originalname),
        contentType: file.mimetype,
        body: file.buffer,
      })),
      fields?.folderId ? fields.folderId : null,
    );
    if (!outcome.ok) throw new BadRequestException(outcome.error.message);

    return { files: await this.files.list(caller, clientId), refused: [...outcome.value.refused] };
  }

  /** A short-lived link, so the file is served by storage and not through this process. */
  @Get('client-files/:id/link')
  async link(@CurrentCaller() caller: Caller, @Param('id') id: string): Promise<{ url: string }> {
    const url = await this.files.linkTo(caller, id);
    if (!url) throw new NotFoundException('No such file');
    return { url };
  }

  @Delete('client-files/:id')
  @RequirePermissions('clients.edit')
  async remove(@CurrentCaller() caller: Caller, @Param('id') id: string): Promise<{ ok: true }> {
    const removed = await this.files.remove(caller, id);
    if (!removed.ok) throw new NotFoundException(removed.error.message);
    return { ok: true };
  }

  @Get('clients/:clientId/folders')
  async folders(
    @CurrentCaller() caller: Caller,
    @Param('clientId') clientId: string,
  ): Promise<{ folders: ClientFolderView[] }> {
    return { folders: await this.files.folders(caller, clientId) };
  }

  @Post('clients/:clientId/folders')
  @RequirePermissions('clients.edit')
  async createFolder(
    @CurrentCaller() caller: Caller,
    @Param('clientId') clientId: string,
    @Body() body: unknown,
  ): Promise<{ folders: ClientFolderView[] }> {
    const parsed = createFolderSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Give the folder a name');
    }
    // The client must exist: reachable and existing are different questions,
    // and a manager can "reach" an id that is nobody's.
    if (!(await this.clients.detail(caller, clientId))) {
      throw new NotFoundException('No such client');
    }
    const created = await this.files.createFolder(
      caller,
      clientId,
      parsed.data.name,
      parsed.data.parentId ?? null,
    );
    if (!created.ok) {
      if (created.error.message === 'No such client') throw new NotFoundException('No such client');
      throw new ConflictException(created.error.message);
    }
    return { folders: await this.files.folders(caller, clientId) };
  }

  @Patch('client-folders/:id')
  @RequirePermissions('clients.edit')
  async renameFolder(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const parsed = renameFolderSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Give the folder a name');
    }
    const renamed = await this.files.renameFolder(caller, id, parsed.data.name);
    if (!renamed.ok) {
      if (renamed.error.message === 'No such folder') throw new NotFoundException('No such folder');
      throw new ConflictException(renamed.error.message);
    }
    return { ok: true };
  }

  @Delete('client-folders/:id')
  @RequirePermissions('clients.edit')
  async removeFolder(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    const removed = await this.files.removeFolder(caller, id);
    if (!removed.ok) {
      if (removed.error.message === 'No such folder') throw new NotFoundException('No such folder');
      throw new ConflictException(removed.error.message);
    }
    return { ok: true };
  }

  @Post('client-files/:id/move')
  @RequirePermissions('clients.edit')
  async move(
    @CurrentCaller() caller: Caller,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const parsed = moveFileSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Say which folder, or null for the top');
    const moved = await this.files.moveFile(caller, id, parsed.data.folderId);
    if (!moved.ok) {
      if (moved.error.message === 'No such file' || moved.error.message === 'No such folder') {
        throw new NotFoundException(moved.error.message);
      }
      throw new ConflictException(moved.error.message);
    }
    return { ok: true };
  }
}
