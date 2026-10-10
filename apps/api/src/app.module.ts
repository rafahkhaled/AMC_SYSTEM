import { AuditModule } from '@amc/audit/http';
import { DrizzleAuditReader, DrizzleUnitOfWork } from '@amc/audit/infrastructure';
import {
  BillingOperations,
  type BillingServices,
  ClientQuotation,
  GenerateStatement,
  ManageQuotations,
  RaiseInvoice,
  ReadBilling,
  ReleaseFromStatement,
  SettleInvoice,
} from '@amc/billing';
import { BillingModule } from '@amc/billing/http';
import {
  DrizzleBillingReader,
  DrizzleDocumentNumbering,
  DrizzleInvoiceRepository,
  DrizzleQuotationRepository,
  DrizzleReportReader,
  DrizzleStatementRepository,
} from '@amc/billing/infrastructure';
import {
  ClientFiles,
  ClientVault,
  ContactLog,
  GenerateLetter,
  LeadWorkflow,
  ReadClients,
  ReadLeads,
  ReceiveDocument,
} from '@amc/clients';
import { ClientsModule } from '@amc/clients/http';
import {
  DrizzleClientFileRepository,
  DrizzleClientRepository,
  DrizzleContactLogRepository,
  DrizzleCredentialRepository,
  DrizzleDocumentRepository,
  DrizzleLeadRepository,
  DrizzleLetterRepository,
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
import { ReadInbox } from '@amc/notifications';
import { NotificationsModule } from '@amc/notifications/http';
import {
  DrizzleNotificationRepository,
  DrizzlePreferenceRepository,
} from '@amc/notifications/infrastructure';
import {
  ContinueWork,
  ManageServices,
  ProjectWorkflow,
  ReadProjects,
  ReadWorkload,
  StartProject,
} from '@amc/projects';
import { SERVICE_TEMPLATES } from '@amc/projects/domain';
import { ProjectsModule } from '@amc/projects/http';
import {
  DrizzleClientServiceRepository,
  DrizzleCustomServiceRepository,
  DrizzleProjectRepository,
  DrizzleServiceCatalogue,
} from '@amc/projects/infrastructure';
import type { FileStorage } from '@amc/storage';
import { ApproveTime, ReadTimer, TimerService } from '@amc/time-tracking';
import { WorkingHours } from '@amc/time-tracking/domain';
import { TimerModule } from '@amc/time-tracking/http';
import {
  DrizzleRunningTimerRepository,
  DrizzleTimeEntryRepository,
  DrizzleWorkingHoursRepository,
} from '@amc/time-tracking/infrastructure';
import { AuditedVault, EnvelopeCipher, LocalKeyProvider } from '@amc/vault';
import { ReadConversations, ReceiveMessage, RecordDelivery, SendMessage } from '@amc/whatsapp';
import { WhatsAppModule } from '@amc/whatsapp/http';
import {
  DrizzleContactDirectory,
  DrizzleConversationReader,
  DrizzleConversationRepository,
  DrizzleMessageRepository,
  MetaWebhookGateway,
} from '@amc/whatsapp/infrastructure';
import {
  BadRequestException,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { ulid } from 'ulid';
import { rateReader, unbilledWork, workAttachment } from './billing/adapters.js';
import { quotationDelivery } from './billing/delivery.js';
import { deadlineSource, holidaySource } from './calendar/adapters.js';
import { projectSummaries } from './clients/project-summaries.js';
import { ConfigModule } from './config/config.module.js';
import { ENVIRONMENT, type Environment, encryptionKey } from './config/env.js';
import { clientFileStore, contactFileStore, documentFileStore } from './documents/adapters.js';
import { HealthModule } from './health/health.module.js';
import { DomainErrorFilter } from './http/domain-error.filter.js';
import { staffReader } from './identity/staff.js';
import { ListsModule } from './lists/lists.module.js';
import { LOGGER } from './observability/logger.js';
import { LoggerModule } from './observability/logger.module.js';
import { RequestContextMiddleware } from './observability/request-context.middleware.js';
import { DATABASE, DatabaseModule } from './persistence/database.module.js';
import { projectContext } from './projects/adapters.js';
import { clientCycles } from './projects/cycles.js';
import { workloadReader } from './projects/workload.js';
import { FILE_STORAGE, StorageModule } from './storage/storage.module.js';
import { assignmentResolver, timerViewReader } from './timer/adapters.js';
import { secretAccessRecorder } from './vault/adapters.js';
import {
  contactLogWriter,
  deadlineReader,
  documentFiler,
  staffNotifier,
  staffPicker,
} from './whatsapp/adapters.js';
import { cloudApiTransport, loggingTransport } from './whatsapp/transport.js';

/**
 * The composition root. This is the only file allowed to know which adapter
 * implements which port; every module below it sees interfaces only.
 */
/**
 * Names for the people who filed or generated things.
 *
 * The users table belongs to identity; the clients module asks for a
 * directory and this is where the two are introduced. Shared by the document
 * list and the letter history, which both show an id otherwise.
 */
function peopleDirectory(db: Database) {
  return {
    async namesFor(userIds: readonly string[]): Promise<Map<string, string>> {
      if (userIds.length === 0) return new Map();
      const rows = await db.execute<{ id: string; display_name: string }>(
        sql`SELECT id, display_name FROM users WHERE id = ANY(${sql.param(userIds)})`,
      );
      return new Map(rows.map((row) => [row.id, row.display_name]));
    },
  };
}

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    HealthModule,
    ListsModule,
    StorageModule,
    ClientsModule.forRootAsync({
      imports: [StorageModule],
      inject: [DATABASE, FILE_STORAGE, ENVIRONMENT],
      useFactory: (db: Database, storage: FileStorage, environment: Environment) => ({
        read: new ReadClients(
          new DrizzleClientRepository(db),
          new DrizzleDocumentRepository(db),
          projectSummaries(db),
          new SystemClock(),
          peopleDirectory(db),
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
        /*
         * The folder every client has (any file, not only the paperwork the
         * practice chases). Audited through the same unit of work, so who
         * put a file there or took it out is on record.
         */
        clientFiles: new ClientFiles(
          new DrizzleUnitOfWork(db, { next: () => ulid() }, new SystemClock()),
          {
            forTransaction: (transaction: unknown, collector: EventCollector) =>
              new DrizzleClientFileRepository(transaction as Database, collector),
          },
          new DrizzleClientFileRepository(db),
          clientFileStore(storage),
          { next: () => ulid() },
        ),
        contactLog: new ContactLog(new DrizzleContactLogRepository(db), contactFileStore(storage), {
          next: () => ulid(),
        }),
        leads: new ReadLeads(new DrizzleLeadRepository(db), new SystemClock()),
        letters: new GenerateLetter(
          new DrizzleLetterRepository(db),
          new DrizzleClientRepository(db),
          // Who the firm signs as. Configuration, not a client fact.
          { name: environment.FIRM_NAME, signatory: environment.FIRM_SIGNATORY },
          { next: () => ulid() },
          peopleDirectory(db),
        ),
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
    NotificationsModule.forRootAsync({
      inject: [DATABASE],
      useFactory: (db: Database) =>
        new ReadInbox(
          new DrizzleNotificationRepository(db),
          new DrizzlePreferenceRepository(db),
          new SystemClock(),
        ),
    }),
    CalendarModule.forRootAsync({
      inject: [DATABASE],
      useFactory: (db: Database) =>
        new ReadCalendar(deadlineSource(db), holidaySource(db), new SystemClock()),
    }),
    ProjectsModule.forRootAsync({
      inject: [DATABASE],
      useFactory: (db: Database) => {
        const catalogue = new DrizzleServiceCatalogue(db);
        const clock = new SystemClock();
        return {
          read: new ReadProjects(
            new DrizzleProjectRepository(db),
            projectContext(db),
            clock,
            catalogue,
            new DrizzleClientServiceRepository(db),
          ),
          workload: new ReadWorkload(workloadReader(db)),
          // The one-off services never come from the recurrence sweep, so this
          // is the only way a de-registration or a penalty waiver is opened.
          start: new StartProject(
            new DrizzleProjectRepository(db),
            new DrizzleClientServiceRepository(db),
            clock,
            { next: () => ulid() },
            catalogue,
          ),
          workflow: new ProjectWorkflow(new DrizzleUnitOfWork(db, { next: () => ulid() }, clock), {
            forTransaction: (transaction: unknown, collector: EventCollector) =>
              new DrizzleProjectRepository(transaction as Database, collector),
          }),
          catalogue,
          /*
           * What happens when a recurring job is finished: carry on with the
           * next one now, or stop it repeating. One transaction, so ending a
           * subscription and the audit row that says why cannot come apart.
           */
          continuing: new ContinueWork(
            new DrizzleUnitOfWork(db, { next: () => ulid() }, clock),
            {
              forTransaction: (transaction: unknown, collector: EventCollector) => ({
                projects: new DrizzleProjectRepository(transaction as Database, collector),
                subscriptions: new DrizzleClientServiceRepository(transaction as Database),
              }),
            },
            catalogue,
            clientCycles(db),
            { next: () => ulid() },
          ),
          /*
           * The services the firm adds itself (item 8). Audited through the
           * same unit of work as everything else, so who added one is on
           * record.
           */
          services: new ManageServices(
            new DrizzleUnitOfWork(db, { next: () => ulid() }, clock),
            {
              forTransaction: (transaction: unknown) =>
                new DrizzleCustomServiceRepository(transaction as Database),
            },
            {
              // The document-type list the administrator edits in Settings,
              // retired entries included: a service may keep requiring a type
              // that has since been taken out of the picker.
              known: async () =>
                new Set(
                  (
                    await db.execute<{ code: string }>(
                      sql`SELECT code FROM reference_options WHERE list = 'document_type'`,
                    )
                  ).map((row) => row.code),
                ),
            },
            new Set(Object.keys(SERVICE_TEMPLATES)),
          ),
        };
      },
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
          approvals: new ApproveTime(new DrizzleTimeEntryRepository(db), clock),
        };
      },
    }),
    /*
     * WhatsApp (P-W).
     *
     * Every port this module declares is answered here, which is the whole
     * point of it declaring them: the module knows there is a way to file a
     * document and a way to tell somebody, and nothing about Postgres, S3 or
     * Meta. Swapping the transport for the logging one is a configuration
     * change, and it is how the whole path is exercised before the business
     * account exists.
     */
    WhatsAppModule.forRootAsync({
      imports: [StorageModule],
      inject: [DATABASE, ENVIRONMENT, LOGGER, FILE_STORAGE],
      useFactory: (
        db: Database,
        environment: Environment,
        logger: Logger,
        storage: FileStorage,
      ) => {
        const ids = { next: () => ulid() };
        const clock = new SystemClock();

        /*
         * The clients module's own use case, not an insert.
         *
         * It is what supersedes a previous version of a document in the right
         * order — supersede first, insert second — and doing that backwards is
         * a bug this project has already had once.
         */
        const documents = new ReceiveDocument(
          new DrizzleUnitOfWork(db, ids, clock),
          {
            forTransaction: (transaction: unknown, collector: EventCollector) =>
              new DrizzleDocumentRepository(transaction as Database, collector),
          },
          new DrizzleDocumentRepository(db),
          documentFileStore(storage),
          ids,
        );

        const conversations = new DrizzleConversationRepository(db);
        const messages = new DrizzleMessageRepository(db);
        const log = contactLogWriter(db, ids);
        const transport =
          environment.WHATSAPP_DRIVER === 'cloud'
            ? cloudApiTransport(
                {
                  // Checked at boot: the environment refuses a cloud driver
                  // with any of these missing, so they are present here.
                  phoneNumberId: environment.WHATSAPP_PHONE_NUMBER_ID ?? '',
                  accessToken: environment.WHATSAPP_ACCESS_TOKEN ?? '',
                  apiVersion: environment.WHATSAPP_API_VERSION,
                },
                logger,
              )
            : loggingTransport(logger);

        return {
          conversations: new ReadConversations(new DrizzleConversationReader(db), clock),
          send: new SendMessage(conversations, messages, log, transport, clock, ids),
          receive: new ReceiveMessage(
            conversations,
            messages,
            new DrizzleContactDirectory(db),
            log,
            documentFiler(documents),
            deadlineReader(db),
            staffPicker(db),
            staffNotifier(db, ids),
            transport,
            { name: { en: environment.FIRM_NAME, ar: environment.FIRM_NAME_ARABIC } },
            clock,
            ids,
          ),
          deliveries: new RecordDelivery(messages),
          gateway: new MetaWebhookGateway({
            appSecret: environment.WHATSAPP_APP_SECRET ?? '',
            verifyToken: environment.WHATSAPP_VERIFY_TOKEN ?? '',
          }),
        };
      },
    }),
    /*
     * Billing (P2).
     *
     * Three of the ports here span two modules, so the adapters live in this
     * app rather than in billing: which hours are unbilled joins time tracking
     * to services, and the rate that applied on a day is a rule the clients
     * module owns and is asked for rather than copied.
     */
    BillingModule.forRootAsync({
      inject: [DATABASE, ENVIRONMENT],
      useFactory: (db: Database, environment: Environment) => {
        const ids = { next: () => ulid() };
        const clock = new SystemClock();
        const rates = rateReader(db, {
          perHourMinor: environment.BILLING_DEFAULT_RATE_MINOR,
          currency: environment.DEFAULT_CURRENCY,
        });
        const settings = {
          vatBasisPoints: environment.BILLING_VAT_BASIS_POINTS,
          paymentTermsDays: environment.BILLING_PAYMENT_TERMS_DAYS,
        };

        /*
         * Built once per transaction, against that transaction's handle and
         * its collector.
         *
         * Constructed once at start-up against a bare handle before, which is
         * why nothing this module did ever reached the audit log: the
         * repositories had nowhere to put the events their aggregates
         * recorded, and no transaction to be part of.
         */
        const forTransaction = (handle: unknown, collector: unknown): BillingServices => {
          const transaction = handle as Database;
          const events = collector as EventCollector;
          const statements = new DrizzleStatementRepository(transaction, events);
          const invoices = new DrizzleInvoiceRepository(transaction, events);
          const quotations = new DrizzleQuotationRepository(transaction, events);
          const attachment = workAttachment(transaction);

          return {
            statements,
            generate: new GenerateStatement(
              unbilledWork(transaction, environment.BUSINESS_TIME_ZONE),
              rates,
              statements,
              attachment,
              clock,
              ids,
            ),
            raise: new RaiseInvoice(
              statements,
              invoices,
              new DrizzleDocumentNumbering(transaction),
              settings,
              clock,
              ids,
            ),
            quotations: new ManageQuotations(
              quotations,
              rates,
              clock,
              ids,
              // The firm's own estimate sequence, continuing from 192.
              new DrizzleDocumentNumbering(transaction, 'quotation'),
              quotationDelivery(transaction, ids, environment.PUBLIC_BASE_URL),
              new CryptoSessionTokens(),
              // The same rate the invoice will carry, so a quotation at five
              // percent is not followed by an invoice at something else.
              settings,
            ),
            settle: new SettleInvoice(invoices, clock, ids),
            release: new ReleaseFromStatement(statements, attachment),
            /*
             * The client's link uses the same token service as a session: 32
             * random bytes, stored only as a SHA-256. It is the same problem
             * — a secret with full entropy that must not be readable from a
             * backup — so it gets the same answer.
             */
            clientQuotations: new ClientQuotation(
              quotations,
              new CryptoSessionTokens(),
              clock,
              environment.FIRM_LEGAL_NAME,
            ),
          };
        };

        return {
          read: new ReadBilling(new DrizzleBillingReader(db), new DrizzleReportReader(db), clock),
          operations: new BillingOperations(new DrizzleUnitOfWork(db, ids, clock), forTransaction),
          /*
           * Straight from the environment, and nullable throughout. The
           * renderer prints a visible marker for anything missing rather than
           * a blank, so a server configured without an IBAN produces an
           * invoice that looks unfinished instead of one that looks finished
           * and cannot be paid.
           */
          firmProfile: {
            legalName: environment.FIRM_LEGAL_NAME,
            addresses: [
              environment.FIRM_ADDRESS_PRIMARY,
              environment.FIRM_ADDRESS_SECONDARY,
            ].filter((address): address is string => Boolean(address)),
            bank: {
              accountHolder: environment.FIRM_BANK_ACCOUNT_HOLDER ?? null,
              iban: environment.FIRM_BANK_IBAN ?? null,
              bic: environment.FIRM_BANK_BIC ?? null,
            },
            logoUrl: environment.FIRM_LOGO_URL ?? null,
            stampUrl: environment.FIRM_STAMP_URL ?? null,
            // So a screen offering the standard rate can name the rate it is
            // actually offering, rather than printing 5% whatever this says.
            vatBasisPoints: settings.vatBasisPoints,
          },
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
        staff: staffReader(db),
        /*
         * Working hours live in the time-tracking module's table. Identity
         * owns the screen that edits them and not the table itself, so the
         * adapter is handed in here.
         */
        workingHours: {
          async set({ userId, startsAt, endsAt, days }) {
            const minutes = (clock: string) => {
              const [h, m] = clock.split(':');
              return Number(h) * 60 + Number(m);
            };
            const hours = WorkingHours.of({
              userId,
              startsAtMinutes: minutes(startsAt),
              endsAtMinutes: minutes(endsAt),
              workingDays: days,
            });
            if (!hours.ok) throw new BadRequestException(hours.error.message);
            await new DrizzleWorkingHoursRepository(db).save(hours.value);
          },
        },
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
