import { describe, expect, it } from 'vitest';
import { ConfigurationError, readEnvironment } from './env.js';

describe('environment configuration', () => {
  it('boots on defaults in development', () => {
    const environment = readEnvironment({ NODE_ENV: 'development' });
    expect(environment.PORT).toBe(3000);
    expect(environment.BUSINESS_TIME_ZONE).toBe('Asia/Dubai');
    expect(environment.DEFAULT_CURRENCY).toBe('AED');
    expect(environment.SESSION_IDLE_MINUTES).toBe(30);
  });

  it('reads numbers out of the strings the environment always gives', () => {
    const environment = readEnvironment({ PORT: '8080', SESSION_ABSOLUTE_HOURS: '8' });
    expect(environment.PORT).toBe(8080);
    expect(environment.SESSION_ABSOLUTE_HOURS).toBe(8);
  });

  it('refuses to start on a port that is not a port', () => {
    expect(() => readEnvironment({ PORT: 'the usual one' })).toThrow(ConfigurationError);
  });

  it('refuses a currency the money code cannot handle', () => {
    expect(() => readEnvironment({ DEFAULT_CURRENCY: 'XYZ' })).toThrow(ConfigurationError);
  });

  it('names every problem at once, so a misconfigured deploy is fixed in one pass', () => {
    try {
      readEnvironment({ PORT: '0', NODE_ENV: 'staging', LOG_LEVEL: 'chatty' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      if (error instanceof ConfigurationError) {
        expect(error.issues.length).toBe(3);
        expect(error.message).toContain('PORT');
        expect(error.message).toContain('NODE_ENV');
        expect(error.message).toContain('LOG_LEVEL');
      }
    }
  });
});
