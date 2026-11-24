import { describe, expect, it } from 'vitest';
import { cleanEmail } from './clean-email.js';

describe('an email address as pasted', () => {
  it('loses the invisible marks WhatsApp puts around English in an Arabic chat', () => {
    expect(cleanEmail('‎name@hotmail.com‎')).toBe('name@hotmail.com');
    expect(cleanEmail('‫name@hotmail.com‬')).toBe('name@hotmail.com');
  });

  it('loses spaces, and turns a wide @ into the ordinary one', () => {
    expect(cleanEmail(' name @ hotmail.com ')).toBe('name@hotmail.com');
    expect(cleanEmail('name＠gmail.com')).toBe('name@gmail.com');
  });

  it('is nothing when nothing is left', () => {
    expect(cleanEmail('‎ ')).toBeNull();
    expect(cleanEmail(null)).toBeNull();
  });
});
