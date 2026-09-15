import type { AuthenticatedCaller } from '../application/authenticate-session.js';

export { CALLER_KEY, CurrentCaller } from '@amc/http-kit';

/** The identity-flavoured caller the guard puts on the request. */
export type { AuthenticatedCaller };

export interface RequestWithCaller {
  amcCaller?: AuthenticatedCaller;
}
