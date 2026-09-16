import { Public } from '@amc/http-kit';
import { type FileStorage, LocalFileStorage } from '@amc/storage';
import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FILE_STORAGE } from './tokens.js';

/**
 * Serves what a local signed link points at.
 *
 * Only the local driver needs this. Against S3 the link goes straight to the
 * bucket and this process never sees the bytes, which is the arrangement worth
 * keeping: a firm's whole document store should not flow through the API.
 *
 * The signature is the authorisation, exactly as with an S3 presigned URL, so
 * the route is not session-guarded. What that buys is a link that can be put
 * in an `img` or `iframe` without a cookie; what it costs is that a link,
 * once copied, works for anyone until it expires. Five minutes is chosen with
 * that in mind, and it is why the key is unguessable rather than sequential.
 */
@Controller('files')
export class FilesController {
  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  @Get('*key')
  @Public()
  async serve(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Query('name') name?: string,
  ): Promise<StreamableFile> {
    if (!(this.storage instanceof LocalFileStorage)) {
      // Against S3 nothing should ever arrive here, and answering would be a
      // second way to reach documents that the bucket policy does not govern.
      throw new NotFoundException();
    }

    // The path after /api/files, which is the storage key. Taken from the
    // signed portion of the URL, and the signature is over exactly this.
    const key = decodeURIComponent(request.path.replace(/^\/api\/files\//, ''));
    if (!this.storage.verify(key, expires, signature)) {
      // An expired link and a forged one give the same answer. Distinguishing
      // them would tell someone probing which keys exist.
      throw new NotFoundException();
    }

    const found = await this.storage.head(key);
    if (!found) throw new NotFoundException();

    const { body } = await this.storage.get(key);
    response.setHeader('Content-Type', found.contentType);
    response.setHeader('Content-Length', String(found.size));
    // Attachment, always. A PDF rendered inline runs in this origin, and an
    // uploaded file is the last thing that should.
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${(name ?? 'document').replace(/["\\\\]/g, '')}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(body);
  }
}
