import { DomainError } from '@amc/kernel';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Logger } from 'pino';
import { LOGGER } from '../observability/logger.js';
import { currentRequestId } from '../observability/request-context.js';

/**
 * One place where a failure becomes a response.
 *
 * Domain errors are expected outcomes and map to their status directly. Anything
 * else is a bug: it is logged in full and answered with a generic message, so an
 * internal detail never reaches a browser.
 */
const STATUS_BY_CODE: Readonly<Record<string, HttpStatus>> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  INVARIANT_VIOLATION: HttpStatus.UNPROCESSABLE_ENTITY,
};

@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = currentRequestId();

    if (exception instanceof DomainError) {
      const status = STATUS_BY_CODE[exception.code] ?? HttpStatus.UNPROCESSABLE_ENTITY;
      this.logger.warn({ err: exception.toJSON() }, 'Request refused by a domain rule');
      response.status(status).json({ error: { ...exception.toJSON(), requestId } });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({
        error: { code: 'HTTP_ERROR', message: exception.message, details: {}, requestId },
      });
      return;
    }

    this.logger.error({ err: exception }, 'Unhandled failure');
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Quote the request id when reporting this.',
        details: {},
        requestId,
      },
    });
  }
}
