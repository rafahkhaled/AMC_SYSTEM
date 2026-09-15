import { Global, Module } from '@nestjs/common';
import type { Logger } from 'pino';
import { ENVIRONMENT, type Environment } from '../config/env.js';
import { LOGGER, createLogger } from './logger.js';

/**
 * The logger as a provider rather than a module-level singleton, so anything
 * that needs it declares that it does, and a test can supply its own.
 */
@Global()
@Module({
  providers: [
    {
      provide: LOGGER,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment): Logger => createLogger(environment),
    },
  ],
  exports: [LOGGER],
})
export class LoggerModule {}
