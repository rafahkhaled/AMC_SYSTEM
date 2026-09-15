import { type ExecutionContext, createParamDecorator } from '@nestjs/common';

/**
 * Who is making this request, in the shape every module needs to know.
 *
 * It lives in a shared package rather than in the identity module so that a
 * controller elsewhere can ask for the caller without its module depending on
 * identity's controllers. Guards remain identity's business; this is only the
 * vocabulary they all speak.
 */
export interface Caller {
  readonly userId: string;
  readonly sessionId: string;
  readonly roles: readonly string[];
  readonly permissions: ReadonlySet<string>;
  readonly displayName: string;
  readonly twoFactorPassed: boolean;
  readonly twoFactorRequired: boolean;
}

export const CALLER_KEY = 'amcCaller';

export interface RequestWithCaller {
  [CALLER_KEY]?: Caller;
}

export const CurrentCaller = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Caller | undefined =>
    context.switchToHttp().getRequest<RequestWithCaller>()[CALLER_KEY],
);
