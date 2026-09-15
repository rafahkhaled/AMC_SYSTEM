import { Public } from '@amc/identity/http';
import { Controller, Get, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { ENVIRONMENT, type Environment } from '../config/env.js';

/**
 * Two questions, deliberately separate.
 *
 * Liveness asks whether the process is running, and a failure means restart me.
 * Readiness asks whether it can serve traffic, and a failure means send traffic
 * elsewhere but leave me alone. Conflating them produces a deployment that
 * restarts itself every time the database is briefly slow.
 */
export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<{ healthy: boolean; detail?: string }>;
}

export const READINESS_CHECKS = Symbol('READINESS_CHECKS');

/**
 * Public, and it has to be: a load balancer cannot sign in, and a health check
 * that requires a session reports the database as unreachable the moment
 * authentication breaks.
 */
@Public()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(READINESS_CHECKS) private readonly checks: readonly ReadinessCheck[],
  ) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  live(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000) };
  }

  @Get('ready')
  async ready(): Promise<{
    status: 'ready' | 'not-ready';
    environment: string;
    checks: { name: string; healthy: boolean; detail?: string }[];
  }> {
    const results = await Promise.all(
      this.checks.map(async (check) => {
        try {
          return { name: check.name, ...(await check.check()) };
        } catch (error) {
          return {
            name: check.name,
            healthy: false,
            detail: error instanceof Error ? error.message : 'unknown failure',
          };
        }
      }),
    );

    return {
      status: results.every((result) => result.healthy) ? 'ready' : 'not-ready',
      environment: this.environment.NODE_ENV,
      checks: results,
    };
  }
}
