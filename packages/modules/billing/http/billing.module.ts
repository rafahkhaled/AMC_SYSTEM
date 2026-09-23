import type { FirmProfile } from '@amc/contracts';
import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import { ClientQuotation } from '../application/client-quotation.js';
import { GenerateStatement } from '../application/generate-statement.js';
import { ManageQuotations } from '../application/manage-quotations.js';
import type { StatementRepository } from '../application/ports.js';
import { RaiseInvoice } from '../application/raise-invoice.js';
import { ReadBilling } from '../application/read-billing.js';
import { ReleaseFromStatement } from '../application/release-from-statement.js';
import { SettleInvoice } from '../application/settle-invoice.js';
import { BillingController } from './billing.controller.js';
import { ClientQuotationController } from './client-quotation.controller.js';
import { FirmProfileToken, StatementRepositoryToken } from './tokens.js';

/** What the composition root has to supply for billing to work. */
export interface BillingParts {
  readonly read: ReadBilling;
  readonly generate: GenerateStatement;
  readonly quotations: ManageQuotations;
  readonly raise: RaiseInvoice;
  readonly settle: SettleInvoice;
  readonly release: ReleaseFromStatement;
  readonly statements: StatementRepository;
  /** What goes on a printed quotation or invoice. */
  readonly firmProfile: FirmProfile;
  /** The client's own view of a quotation, reached by link and no account. */
  readonly clientQuotations: ClientQuotation;
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest identifies a dynamic module by its class
export class BillingModule {
  static forRootAsync(options: {
    imports?: DynamicModule['imports'];
    inject?: (InjectionToken | OptionalFactoryDependency)[];
    useFactory: (...dependencies: never[]) => BillingParts | Promise<BillingParts>;
  }): DynamicModule {
    const PARTS = Symbol('amc.billing.parts');

    return {
      module: BillingModule,
      imports: options.imports ?? [],
      controllers: [BillingController, ClientQuotationController],
      providers: [
        {
          provide: PARTS,
          inject: options.inject ?? [],
          useFactory: options.useFactory as (...args: unknown[]) => BillingParts,
        },
        { provide: ReadBilling, inject: [PARTS], useFactory: (p: BillingParts) => p.read },
        {
          provide: GenerateStatement,
          inject: [PARTS],
          useFactory: (p: BillingParts) => p.generate,
        },
        {
          provide: ManageQuotations,
          inject: [PARTS],
          useFactory: (p: BillingParts) => p.quotations,
        },
        { provide: RaiseInvoice, inject: [PARTS], useFactory: (p: BillingParts) => p.raise },
        { provide: SettleInvoice, inject: [PARTS], useFactory: (p: BillingParts) => p.settle },
        {
          provide: ReleaseFromStatement,
          inject: [PARTS],
          useFactory: (p: BillingParts) => p.release,
        },
        {
          provide: StatementRepositoryToken,
          inject: [PARTS],
          useFactory: (p: BillingParts) => p.statements,
        },
        {
          provide: FirmProfileToken,
          inject: [PARTS],
          useFactory: (p: BillingParts) => p.firmProfile,
        },
        {
          provide: ClientQuotation,
          inject: [PARTS],
          useFactory: (p: BillingParts) => p.clientQuotations,
        },
      ],
      exports: [
        ReadBilling,
        GenerateStatement,
        ManageQuotations,
        RaiseInvoice,
        SettleInvoice,
        ReleaseFromStatement,
      ],
    };
  }
}
