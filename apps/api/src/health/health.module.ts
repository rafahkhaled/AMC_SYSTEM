import { Module } from '@nestjs/common';
import { DATABASE_POOL, type DatabasePool } from '../persistence/database.module.js';
import { databaseReadiness } from './database.readiness.js';
import { HealthController, READINESS_CHECKS, type ReadinessCheck } from './health.controller.js';

/**
 * Readiness checks are registered here as adapters arrive. Redis joins with the
 * job queue in P0-12.
 */
@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: READINESS_CHECKS,
      inject: [DATABASE_POOL],
      useFactory: (pool: DatabasePool): ReadinessCheck[] => [databaseReadiness(pool)],
    },
  ],
})
export class HealthModule {}
