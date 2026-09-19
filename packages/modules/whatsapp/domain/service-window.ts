import { Conflict, type Result, err, ok } from '@amc/kernel';

/**
 * The twenty-four hour rule, which is Meta's and not ours.
 *
 * A business may write whatever it likes to somebody who has written to it in
 * the last twenty-four hours. Outside that window it may send only a template
 * that Meta approved in advance, with the variables filled in. There is no way
 * around this and no way to ask for an exception: a free-text message sent to a
 * closed window is rejected by the API, and enough of them is how an account
 * gets its quality rating cut.
 *
 * It is here, in the domain, rather than in the adapter that talks to Meta,
 * because it changes what the rest of the system may do. A chase that cannot go
 * out as free text has to go out as a template, and the code that decides to
 * chase somebody needs to know that before it writes the message, not after the
 * send fails.
 */

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type WindowState = 'open' | 'closed';

export function windowStateAt(lastInboundAt: Date | null, now: Date): WindowState {
  if (!lastInboundAt) return 'closed';
  return now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS ? 'open' : 'closed';
}

/** When the window shuts, for a screen that wants to show a person the clock. */
export function windowClosesAt(lastInboundAt: Date | null): Date | null {
  return lastInboundAt ? new Date(lastInboundAt.getTime() + SERVICE_WINDOW_MS) : null;
}

/** What is being sent: our own words, or one of Meta's approved templates. */
export type OutboundShape = { kind: 'text'; body: string } | { kind: 'template'; name: string };

/**
 * Whether this may be sent now.
 *
 * A template is always allowed — inside the window as well as outside it —
 * because a chase written as a template is still a chase, and refusing it
 * inside the window would mean the sender had to care which side of the line
 * it was on.
 */
export function mayBeSent(
  shape: OutboundShape,
  lastInboundAt: Date | null,
  now: Date,
): Result<void, Conflict> {
  if (shape.kind === 'template') return ok(undefined);
  if (windowStateAt(lastInboundAt, now) === 'open') return ok(undefined);

  return err(
    new Conflict(
      'This client has not written in the last 24 hours, so WhatsApp will only accept an approved template',
    ),
  );
}
