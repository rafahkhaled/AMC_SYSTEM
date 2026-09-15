import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  AllowPendingTwoFactor,
  PENDING_TWO_FACTOR_KEY,
  PERMISSIONS_KEY,
  PUBLIC_KEY,
  Public,
  RequirePermissions,
} from './access.js';

/** The keys are a contract between modules, so they are asserted, not assumed. */
describe('access decorators', () => {
  class Example {
    @RequirePermissions('audit.read', 'export.all')
    guarded(): void {}

    @Public()
    open(): void {}

    @AllowPendingTwoFactor()
    halfway(): void {}
  }

  const example = new Example();

  it('records every permission a route requires', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, example.guarded)).toEqual([
      'audit.read',
      'export.all',
    ]);
  });

  it('marks a route public', () => {
    expect(Reflect.getMetadata(PUBLIC_KEY, example.open)).toBe(true);
  });

  it('marks a route reachable before the second factor', () => {
    expect(Reflect.getMetadata(PENDING_TWO_FACTOR_KEY, example.halfway)).toBe(true);
  });

  it('leaves an undecorated route with nothing, so it stays closed', () => {
    class Bare {
      plain(): void {}
    }
    expect(Reflect.getMetadata(PERMISSIONS_KEY, new Bare().plain)).toBeUndefined();
    expect(Reflect.getMetadata(PUBLIC_KEY, new Bare().plain)).toBeUndefined();
  });
});
