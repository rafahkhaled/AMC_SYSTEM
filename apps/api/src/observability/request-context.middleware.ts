import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { newRequestId, runWithRequestContext } from './request-context.js';

/**
 * Opens a context for every request and echoes the identifier back, so a user
 * reporting a problem can quote a number that leads straight to the log lines
 * and the audit rows for exactly that action.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const inbound = request.header('x-request-id');
    const requestId = inbound && inbound.length <= 200 ? inbound : newRequestId();
    response.setHeader('x-request-id', requestId);
    runWithRequestContext({ requestId, ipAddress: request.ip }, () => next());
  }
}
