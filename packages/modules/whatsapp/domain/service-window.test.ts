import { describe, expect, it } from 'vitest';
import { mayBeSent, windowClosesAt, windowStateAt } from './service-window.js';

const noon = new Date('2026-09-17T12:00:00.000Z');
const minutesBefore = (minutes: number) => new Date(noon.getTime() - minutes * 60_000);

describe('the service window', () => {
  it('is open while the client wrote inside the last day', () => {
    expect(windowStateAt(minutesBefore(1), noon)).toBe('open');
    expect(windowStateAt(minutesBefore(23 * 60), noon)).toBe('open');
  });

  it('shuts exactly twenty-four hours after they wrote', () => {
    expect(windowStateAt(minutesBefore(24 * 60 - 1), noon)).toBe('open');
    // On the boundary itself it is already shut. Meta compares the same way,
    // and being one minute more generous than the API means the send fails
    // rather than being caught here where something can be done about it.
    expect(windowStateAt(minutesBefore(24 * 60), noon)).toBe('closed');
    expect(windowStateAt(minutesBefore(24 * 60 + 1), noon)).toBe('closed');
  });

  it('is shut for somebody who has never written', () => {
    expect(windowStateAt(null, noon)).toBe('closed');
  });

  it('names the moment it shuts, for a screen that shows the clock', () => {
    expect(windowClosesAt(minutesBefore(60))?.toISOString()).toBe('2026-09-18T11:00:00.000Z');
    expect(windowClosesAt(null)).toBeNull();
  });
});

describe('what may be sent', () => {
  it('allows our own words while the window is open', () => {
    const allowed = mayBeSent({ kind: 'text', body: 'Thanks, received' }, minutesBefore(30), noon);
    expect(allowed.ok).toBe(true);
  });

  it('refuses our own words once it has shut, and says why', () => {
    const refused = mayBeSent({ kind: 'text', body: 'Any news?' }, minutesBefore(48 * 60), noon);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.message).toContain('approved template');
  });

  it('refuses our own words to somebody who has never written', () => {
    expect(mayBeSent({ kind: 'text', body: 'Hello' }, null, noon).ok).toBe(false);
  });

  it('allows a template whichever side of the line it is', () => {
    expect(mayBeSent({ kind: 'template', name: 'documents_due' }, null, noon).ok).toBe(true);
    expect(mayBeSent({ kind: 'template', name: 'documents_due' }, minutesBefore(30), noon).ok).toBe(
      true,
    );
  });
});
