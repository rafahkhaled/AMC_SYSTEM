import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENVIRONMENT, readEnvironment } from '../config/env.js';
import { RequestContextMiddleware } from '../observability/request-context.middleware.js';
import { HealthController, READINESS_CHECKS, type ReadinessCheck } from './health.controller.js';

describe('health endpoints', () => {
  let app: INestApplication;

  const failingCheck: ReadinessCheck = {
    name: 'database',
    check: async () => ({ healthy: false, detail: 'not connected yet' }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: ENVIRONMENT, useValue: readEnvironment({ NODE_ENV: 'test' }) },
        { provide: READINESS_CHECKS, useValue: [failingCheck] },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(new RequestContextMiddleware().use.bind(new RequestContextMiddleware()));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports liveness while the process is up', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('separates readiness from liveness, so a cold database does not cause a restart loop', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(response.body.status).toBe('not-ready');
    expect(response.body.checks).toEqual([
      { name: 'database', healthy: false, detail: 'not connected yet' },
    ]);
  });

  it('echoes a request id that ties a complaint to its log lines', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
