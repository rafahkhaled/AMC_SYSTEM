import { describe, expect, it } from 'vitest';
import { definedOnly } from './environment.js';

describe('definedOnly', () => {
  it('drops a variable set to nothing, which is what compose writes', () => {
    // `NOTIFICATION_FROM: ${NOTIFICATION_FROM:-}` puts NOTIFICATION_FROM= into
    // the container. The worker crash-looped on it: .optional() accepts
    // undefined and .email() rejects ''.
    expect(definedOnly({ NOTIFICATION_FROM: '' })).toEqual({});
  });

  it('drops one that is only whitespace', () => {
    expect(definedOnly({ FIRM_NAME_ARABIC: '   ' })).toEqual({});
  });

  it('keeps real values, including ones that only look empty', () => {
    expect(definedOnly({ A: 'x', B: '0', C: 'false', D: ' padded ' })).toEqual({
      A: 'x',
      B: '0',
      C: 'false',
      D: ' padded ',
    });
  });

  it('leaves undefined alone rather than turning it into a key', () => {
    expect(Object.keys(definedOnly({ MISSING: undefined }))).toEqual([]);
  });
});
