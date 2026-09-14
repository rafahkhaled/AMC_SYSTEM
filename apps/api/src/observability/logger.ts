import type { LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';
import type { Environment } from '../config/env.js';
import { currentRequestContext } from './request-context.js';

/**
 * Structured logging, because a log line that cannot be searched is a log line
 * that will not be read. Every line carries the request identifier, and the
 * redaction list is deliberately wide: this system holds tax credentials, and a
 * password that reaches a log file has escaped the vault that was built for it.
 */
export function createLogger(environment: Environment): Logger {
  return pino({
    level: environment.LOG_LEVEL,
    base: { service: 'amc-api', env: environment.NODE_ENV },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.passwordHash',
        '*.token',
        '*.accessToken',
        '*.refreshToken',
        '*.secret',
        '*.emaraTaxPassword',
        '*.trn',
      ],
      censor: '[redacted]',
    },
    mixin: () => {
      const context = currentRequestContext();
      return context ? { requestId: context.requestId, userId: context.userId } : {};
    },
    ...(environment.LOG_PRETTY
      ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
      : {}),
  });
}

/** Adapts pino to the logger Nest expects, so framework logs land in the same stream. */
export class PinoLoggerService implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: string): void {
    this.logger.info({ context }, String(message));
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.logger.error({ context, stack }, String(message));
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, String(message));
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, String(message));
  }

  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, String(message));
  }
}

export const LOGGER = Symbol('LOGGER');
