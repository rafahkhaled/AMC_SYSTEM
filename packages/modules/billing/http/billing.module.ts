import type { FirmProfile } from '@amc/contracts';
import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import { BillingOperations } from '../application/billing-operations.js';
import { ReadBilling } from '../application/read-billing.js';
import { BillingController } from './billing.controller.js';
import { ClientQuotationController } from './client-quotation.controller.js';
import { FirmProfileToken } from './tokens.js';

/** What the composition root has to supply for billing to work. */
export interface BillingParts {
  readonly read: ReadBilling;
  /**
   * Everything that changes something, and the transaction it changes it in.
   *
   * The services used to be provided one by one and constructed against a
   * bare database handle, which is how this module wrote nothing to the audit
   * log for an entire phase.
   */
  readonly operations: BillingOperations;
  /** What goes on a printed quotation or invoice. */
  readonly firmProfile: FirmProfile;
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
          provide: BillingOperations,
          inject: [PARTS],
          useFactory: (p: BillingParts) => p.operations,
        },
        {
          provide: FirmProfileToken,
          inject: [PARTS],
          useFactory: (p: BillingParts) => p.firmProfile,
        },
      ],
      exports: [ReadBilling, BillingOperations],
    };
  }
}
