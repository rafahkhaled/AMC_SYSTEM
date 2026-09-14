import { Module } from '@nestjs/common';
import { HealthController, READINESS_CHECKS, type ReadinessCheck } from './health.controller.js';

/**
 * Readiness checks are registered here as adapters arrive. Postgres and Redis
 * join in P0-05 and P0-12; until then the list is honestly empty rather than
 * reporting a health it cannot know.
 */
@Module({
  controllers: [HealthController],
  providers: [{ provide: READINESS_CHECKS, useValue: [] as ReadinessCheck[] }],
})
export class HealthModule {}
