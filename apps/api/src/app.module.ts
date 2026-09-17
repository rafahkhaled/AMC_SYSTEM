import { AuditModule } from '@amc/audit/http';
import { DrizzleAuditReader, DrizzleUnitOfWork } from '@amc/audit/infrastructure';
import {
  ClientVault,
  ContactLog,
  LeadWorkflow,
  ReadClients,
  ReadLeads,
  ReceiveDocument,
} from '@amc/clients';
import { ClientsModule } from '@amc/clients/http';
import {
  DrizzleClientRepository,
  DrizzleContactLogRepository,
  DrizzleCredentialRepository,
  DrizzleDocumentRepository,
  DrizzleLeadRepository,
} from '@amc/clients/infrastructure';
import type { Database } from '@amc/database';
import { ReadCalendar } from '@amc/deadlines';
import { CalendarModule } from '@amc/deadlines/http';
import { IdentityModule } from '@amc/identity/http';
import {
  Argon2PasswordHasher,
  CryptoSessionTokens,
  DrizzleSessionRepository,
  DrizzleUserRepository,
  TotpTwoFactorService,
} from '@amc/identity/infrastructure';
import { type EventCollector, SystemClock } from '@amc/kernel';
import { ReadTasks, ReadWorkload, TaskWorkflow } from '@amc/services';
import { TasksModule } from '@amc/services/http';
import { DrizzleTaskRepository } from '@amc/services/infrastructure';
import type { FileStorage } from '@amc/storage';
import { ReadTimer, TimerService } from '@amc/time-tracking';
import { TimerModule } from '@amc/time-tracking/http';
import {
  DrizzleRunningTimerRepository,
  DrizzleTimeEntryRepository,
  DrizzleWorkingHoursRepository,
} from '@amc/time-tracking/infrastructure';
import { AuditedVault, EnvelopeCipher, LocalKeyProvider } from '@amc/vault';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ulid } from 'ulid';
import { deadlineSource, holidaySource } from './calendar/adapters.js';
import { taskSummaries } from './clients/task-summaries.js';
import { ConfigModule } from './config/config.module.js';
import { ENVIRONMENT, type Environment, encryptionKey } from './config/env.js';
import { contactFileStore, documentFileStore } from './documents/adapters.js';
import { HealthModule } from './health/health.module.js';
import { DomainErrorFilter } from './http/domain-error.filter.js';
import { LoggerModule } from './observability/logger.module.js';
import { RequestContextMiddleware } from './observability/request-context.middleware.js';
import { DATABASE, DatabaseModule } from './persistence/database.module.js';
import { FILE_STORAGE, StorageModule } from './storage/storage.module.js';
import { taskContext } from './tasks/adapters.js';
import { workloadReader } from './tasks/workload.js';
import { assignmentResolver, timerViewReader } from './timer/adapters.js';
import { secretAccessRecorder } from './vault/adapters.js';

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
    StorageModule,
    ClientsModule.forRootAsync({
      imports: [StorageModule],
      inject: [DATABASE, FILE_STORAGE, ENVIRONMENT],
      useFactory: (db: Database, storage: FileStorage, environment: Environment) => ({
        read: new ReadClients(
          new DrizzleClientRepository(db),
          new DrizzleDocumentRepository(db),
          taskSummaries(db),
          new SystemClock(),
        ),
        documents: new ReceiveDocument(
          new DrizzleUnitOfWork(db, { next: () => ulid() }, new SystemClock()),
          {
            forTransaction: (transaction: unknown, collector: EventCollector) =>
              new DrizzleDocumentRepository(transaction as Database, collector),
          },
          new DrizzleDocumentRepository(db),
          documentFileStore(storage),
          { next: () => ulid() },
        ),
        /*
         * The vault writes the audit row before it hands back a plaintext, so
         * a credential that could not be logged is not revealed. Its recorder
         * is the audit module's, given here because neither package may
         * depend on the other.
         */
        vault: new ClientVault(
          new DrizzleCredentialRepository(db),
          new AuditedVault(
            new EnvelopeCipher(new LocalKeyProvider(encryptionKey(environment))),
            secretAccessRecorder(db, { next: () => ulid() }),
          ),
          { next: () => ulid() },
        ),
        contactLog: new ContactLog(new DrizzleContactLogRepository(db), contactFileStore(storage), {
          next: () => ulid(),
        }),
        leads: new ReadLeads(new DrizzleLeadRepository(db), new SystemClock()),
        leadWorkflow: new LeadWorkflow(
          new DrizzleUnitOfWork(db, { next: () => ulid() }, new SystemClock()),
          {
            forTransaction: (transaction: unknown, collector: EventCollector) => ({
              leads: new DrizzleLeadRepository(transaction as Database, collector),
              clients: new DrizzleClientRepository(transaction as Database, collector),
            }),
          },
          { next: () => ulid() },
        ),
      }),
    }),
    CalendarModule.forRootAsync({
      inject: [DATABASE],
      useFactory: (db: Database) =>
        new ReadCalendar(deadlineSource(db), holidaySource(db), new SystemClock()),
    }),
    TasksModule.forRootAsync({
      inject: [DATABASE],
      useFactory: (db: Database) => ({
        read: new ReadTasks(new DrizzleTaskRepository(db), taskContext(db), new SystemClock()),
        workload: new ReadWorkload(workloadReader(db)),
        workflow: new TaskWorkflow(
          new DrizzleUnitOfWork(db, { next: () => ulid() }, new SystemClock()),
          {
            forTransaction: (transaction: unknown, collector: EventCollector) =>
              new DrizzleTaskRepository(transaction as Database, collector),
          },
        ),
      }),
    }),
    TimerModule.forRootAsync({
      inject: [DATABASE],
      useFactory: (db: Database) => {
        const ids = { next: () => ulid() };
        const clock = new SystemClock();
        return {
          timer: new TimerService(
            new DrizzleRunningTimerRepository(db),
            new DrizzleTimeEntryRepository(db),
            assignmentResolver(db, ids),
            new DrizzleWorkingHoursRepository(db),
            clock,
            ids,
          ),
          read: new ReadTimer(timerViewReader(db), clock),
        };
      },
    }),
    AuditModule.forRootAsync({
      inject: [DATABASE],
      useFactory: (db: Database) => new DrizzleAuditReader(db),
    }),
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
        twoFactor: new TotpTwoFactorService(
          new EnvelopeCipher(new LocalKeyProvider(encryptionKey(environment))),
          'AMC',
        ),
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
