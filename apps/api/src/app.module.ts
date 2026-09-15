import { DrizzleUnitOfWork } from '@amc/audit/infrastructure';
import type { Database } from '@amc/database';
import { IdentityModule } from '@amc/identity/http';
import {
  Argon2PasswordHasher,
  CryptoSessionTokens,
  DrizzleSessionRepository,
  DrizzleUserRepository,
  SecretBox,
  TotpTwoFactorService,
} from '@amc/identity/infrastructure';
import { type EventCollector, SystemClock } from '@amc/kernel';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ulid } from 'ulid';
import { ConfigModule } from './config/config.module.js';
import { ENVIRONMENT, type Environment, encryptionKey } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { DomainErrorFilter } from './http/domain-error.filter.js';
import { LoggerModule } from './observability/logger.module.js';
import { RequestContextMiddleware } from './observability/request-context.middleware.js';
import { DATABASE, DatabaseModule } from './persistence/database.module.js';

/**
 * The composition root. This is the only file allowed to know which adapter
 * implements which port; every module below it sees interfaces only.
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    HealthModule,
    IdentityModule.forRootAsync({
      inject: [DATABASE, ENVIRONMENT],
      useFactory: (db: Database, environment: Environment) => ({
        // Reads, for authenticating a session on every request.
        users: new DrizzleUserRepository(db),
        sessions: new DrizzleSessionRepository(db),
        // Writes, each inside one transaction that also carries its audit rows.
        unitOfWork: new DrizzleUnitOfWork(db, { next: () => ulid() }, new SystemClock()),
        repositories: {
          forTransaction: (transaction: unknown, collector: EventCollector) => ({
            users: new DrizzleUserRepository(transaction as Database, collector),
            sessions: new DrizzleSessionRepository(transaction as Database, collector),
          }),
        },
        hasher: new Argon2PasswordHasher(),
        tokens: new CryptoSessionTokens(),
        twoFactor: new TotpTwoFactorService(new SecretBox(encryptionKey(environment)), 'AMC'),
        clock: new SystemClock(),
        ids: { next: () => ulid() },
        limits: {
          idleMinutes: environment.SESSION_IDLE_MINUTES,
          absoluteHours: environment.SESSION_ABSOLUTE_HOURS,
        },
        cookies: { secure: environment.NODE_ENV === 'production' },
      }),
    }),
  ],
  providers: [
    // Registered here rather than in main.ts, so that every way of starting
    // this application gets the same error handling. When it lived in the
    // bootstrap file, tests silently ran without it and saw a different shape
    // of error body than real clients do.
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
