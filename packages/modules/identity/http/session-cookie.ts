import { SESSION_COOKIE } from '@amc/contracts';
import type { Response } from 'express';

export interface CookieSettings {
  /** False only for local development over plain http. */
  readonly secure: boolean;
}

/** Injection token, so the flags come from configuration rather than a guess. */
export const COOKIE_SETTINGS = Symbol('COOKIE_SETTINGS');

/**
 * The session cookie, with the flags that matter.
 *
 * httpOnly keeps it out of reach of any script on the page, so a cross-site
 * scripting bug cannot walk away with a session. sameSite strict means the
 * browser never sends it on a request that another site initiated, which is
 * what removes cross-site request forgery for an internal tool like this one.
 * secure keeps it off plain http in production. No expiry attribute is set, so
 * it dies with the browser session; the server's two expiries are the real
 * limits and the ones that cannot be edited by the client.
 */
export function setSessionCookie(
  response: Response,
  token: string,
  settings: CookieSettings,
): void {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: settings.secure,
    path: '/',
  });
}

export function clearSessionCookie(response: Response, settings: CookieSettings): void {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: settings.secure,
    path: '/',
  });
}
