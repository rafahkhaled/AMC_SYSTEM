import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { RequestContextMiddleware } from './observability/request-context.middleware.js';

/**
 * The composition root. Business modules are mounted here as each phase lands,
 * and this file is the only place allowed to know about all of them.
 */
@Module({
  imports: [ConfigModule, HealthModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
