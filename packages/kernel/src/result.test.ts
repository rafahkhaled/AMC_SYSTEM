import { describe, expect, it } from 'vitest';
import { NotFound } from './errors.js';
import { all, andThen, err, isErr, isOk, map, mapErr, ok, unwrapOr } from './result.js';

describe('Result', () => {
  it('narrows to success and failure', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err('nope'))).toBe(true);
  });

  it('maps a success and leaves a failure alone', () => {
    expect(map(ok(2), (value) => value * 2)).toEqual({ ok: true, value: 4 });
    expect(map(err('boom'), (value: number) => value * 2)).toEqual({ ok: false, error: 'boom' });
  });

  it('maps the failure side', () => {
    const mapped = mapErr(err('missing'), (reason) => new NotFound(reason));
    expect(isErr(mapped) && mapped.error.code).toBe('NOT_FOUND');
  });

  it('short-circuits a chain at the first failure', () => {
    const chained = andThen(ok(1), () => err('stopped'));
    expect(chained).toEqual({ ok: false, error: 'stopped' });
  });

  it('collects many results and reports the first failure', () => {
    expect(all([ok(1), ok(2)])).toEqual({ ok: true, value: [1, 2] });
    expect(all([ok(1), err('second failed'), err('third failed')])).toEqual({
      ok: false,
      error: 'second failed',
    });
  });

  it('falls back on failure', () => {
    expect(unwrapOr(err('boom'), 7)).toBe(7);
  });
});
