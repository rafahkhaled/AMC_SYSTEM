import type { INestApplication } from '@nestjs/common';

/**
 * How the application is created, for the real process and for the tests alike.
 *
 * Keep the bytes of every request body alongside the parsed one. The WhatsApp
 * webhook is authenticated by an HMAC over exactly what Meta sent, and
 * JSON.parse followed by JSON.stringify does not reproduce those bytes — key
 * order, whitespace and unicode escapes all differ, and the digest differs with
 * them. Without this the signature never matches and every message a client
 * sends is refused. It lived only in `main.ts`, so a test that built the app
 * itself would have refused every delivery for a reason that is not real.
 */
export const APPLICATION_OPTIONS = { rawBody: true } as const;

/**
 * What every running copy of the API is told about itself.
 *
 * One function, used by the real process and by the tests, because a setting
 * that exists only in `main.ts` is a setting the tests never exercise — which is
 * how every address in the production audit log came to be the proxy's.
 */
export function configureApp(app: INestApplication, options: { trustProxyHops: number }): void {
  /**
   * Everything the API serves lives under /api, so the browser application can
   * be served from the same origin as the API it talks to. That is not a
   * cosmetic choice: the session cookie is SameSite=Strict, which means a
   * different origin would never send it at all.
   */
  app.setGlobalPrefix('api');

  const express = app.getHttpAdapter().getInstance();

  // Do not advertise the framework. It tells an attacker which advisories to
  // try and tells an honest user nothing.
  express.disable('x-powered-by');

  /*
   * Which forwarded address is believed.
   *
   * A number of hops rather than `true`. With `true` every address in the
   * header is trusted, and the left-most is whatever the caller typed.
   */
  express.set('trust proxy', options.trustProxyHops);

  /*
   * How large a JSON body may be.
   *
   * The default is 100 KB, and a branch's logo or stamp is sent as an image in
   * the body: an ordinary 200 KB logo was refused, as a server error. One
   * megabyte covers the 400 KB image limit, base64 and all. Files go by
   * multipart, which has its own limits, so this does not touch uploads.
   */
  (
    app as unknown as { useBodyParser(type: string, options: { limit: string }): void }
  ).useBodyParser('json', { limit: '1mb' });
}
