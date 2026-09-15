import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import type { AuditReader } from '../application/ports.js';
import { ReadAuditLog } from '../application/read-audit-log.js';
import { AuditController } from './audit.controller.js';

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest identifies a dynamic module by its class
export class AuditModule {
  /** For tests, where the reader is already in hand. */
  static withReader(reader: AuditReader): DynamicModule {
    return AuditModule.forRootAsync({ useFactory: () => reader });
  }

  /** For the application, where the reader needs the connection pool. */
  static forRootAsync(options: {
    inject?: (InjectionToken | OptionalFactoryDependency)[];
    useFactory: (...dependencies: never[]) => AuditReader | Promise<AuditReader>;
  }): DynamicModule {
    const READER = Symbol('AUDIT_READER');
    return {
      module: AuditModule,
      controllers: [AuditController],
      providers: [
        {
          provide: READER,
          inject: options.inject ?? [],
          useFactory: options.useFactory as (...args: unknown[]) => AuditReader,
        },
        {
          provide: ReadAuditLog,
          inject: [READER],
          useFactory: (reader: AuditReader) => new ReadAuditLog(reader),
        },
      ],
      exports: [ReadAuditLog],
    };
  }
}
