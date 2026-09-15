import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedCaller } from '../application/authenticate-session.js';

/** Where the guard leaves the caller for the rest of the request to find. */
export const CALLER_KEY = 'amcCaller';

export interface RequestWithCaller {
  [CALLER_KEY]?: AuthenticatedCaller;
}

/** `me(@CurrentCaller() caller: AuthenticatedCaller)` in a controller. */
export const CurrentCaller = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedCaller | undefined => {
    const request = context.switchToHttp().getRequest<RequestWithCaller>();
    return request[CALLER_KEY];
  },
);
