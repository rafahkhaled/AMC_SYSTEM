import { describe, expect, it } from 'vitest';
import { Session } from './session.js';

const at = (iso: string) => new Date(iso);
const limits = { idleMinutes: 30, absoluteHours: 12 };

function start(now = at('2026-09-15T06:00:00Z'), twoFactorPassed = true): Session {
  return Session.start({ id: 'session-1', userId: 'user-1', now, limits, twoFactorPassed });
}

describe('Session', () => {
  it('is valid immediately after signing in', () => {
    const session = start();
    expect(session.isValidAt(at('2026-09-15T06:00:01Z'))).toBe(true);
  });

  it('dies after thirty minutes of inactivity, which covers the abandoned laptop', () => {
    const session = start();
    expect(session.isValidAt(at('2026-09-15T06:29:00Z'))).toBe(true);
    expect(session.isValidAt(at('2026-09-15T06:31:00Z'))).toBe(false);
  });

  it('extends the idle window each time it is used', () => {
    const session = start();
    expect(session.touch(at('2026-09-15T06:20:00Z')).ok).toBe(true);
    // Without the touch this would already be dead.
    expect(session.isValidAt(at('2026-09-15T06:45:00Z'))).toBe(true);
  });

  it('still dies at twelve hours however busy it has been', () => {
    const session = start();
    // Used every twenty minutes all day: the idle limit never bites.
    for (let minute = 20; minute <= 700; minute += 20) {
      session.touch(new Date(at('2026-09-15T06:00:00Z').getTime() + minute * 60_000));
    }
    const beyondAbsolute = session.touch(at('2026-09-15T18:30:00Z'));
    expect(beyondAbsolute.ok).toBe(false);
    if (!beyondAbsolute.ok) expect(beyondAbsolute.error.message).toContain('maximum length');
  });

  it('explains which limit ended it, rather than a bare failure', () => {
    const session = start();
    const idle = session.touch(at('2026-09-15T07:00:00Z'));
    expect(idle.ok).toBe(false);
    if (!idle.ok) expect(idle.error.message).toContain('inactivity');
  });

  it('is finished once revoked, even well inside both limits', () => {
    const session = start();
    session.revoke(at('2026-09-15T06:05:00Z'));
    expect(session.isValidAt(at('2026-09-15T06:06:00Z'))).toBe(false);
    expect(session.touch(at('2026-09-15T06:06:00Z')).ok).toBe(false);
  });

  it('starts half authenticated when a second factor is due', () => {
    const session = start(at('2026-09-15T06:00:00Z'), false);
    expect(session.twoFactorPassed).toBe(false);
    // Still a valid session: it exists to carry the verification step.
    expect(session.isValidAt(at('2026-09-15T06:01:00Z'))).toBe(true);
  });

  it('records the second factor once, and not again', () => {
    const session = start(at('2026-09-15T06:00:00Z'), false);
    session.passTwoFactor(at('2026-09-15T06:00:30Z'));
    session.passTwoFactor(at('2026-09-15T06:00:40Z'));

    expect(session.twoFactorPassed).toBe(true);
    const passes = session
      .pullEvents()
      .filter((event) => event.name === 'identity.session.two_factor_passed');
    expect(passes).toHaveLength(1);
  });

  it('ignores a second revoke rather than recording it twice', () => {
    const session = start();
    session.revoke(at('2026-09-15T06:05:00Z'));
    session.revoke(at('2026-09-15T06:06:00Z'));
    const revocations = session
      .pullEvents()
      .filter((event) => event.name === 'identity.session.revoked');
    expect(revocations).toHaveLength(1);
  });
});
