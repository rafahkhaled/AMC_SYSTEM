import { Global, Module } from '@nestjs/common';
import { ENVIRONMENT, type Environment, readEnvironment } from './env.js';

/**
 * Configuration is read once and injected. Nothing below this module reads
 * process.env directly, which is what lets a test construct a module with a
 * different configuration instead of mutating global state.
 */
@Global()
@Module({
  providers: [{ provide: ENVIRONMENT, useFactory: (): Environment => readEnvironment() }],
  exports: [ENVIRONMENT],
})
export class ConfigModule {}
