import {
  type DynamicModule,
  type ForwardReference,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
  type Type,
} from '@nestjs/common';
import { ReadClients } from '../application/read-clients.js';
import { ReceiveDocument } from '../application/receive-document.js';
import { ClientsController } from './clients.controller.js';
import { DocumentsController } from './documents.controller.js';

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest identifies a dynamic module by its class
export class ClientsModule {
  static forRootAsync(options: {
    /**
     * Modules whose providers the factory needs.
     *
     * `DatabaseModule` is global and reaches every module without this;
     * storage deliberately is not. A global provider is one nothing has to
     * declare it uses, which is convenient exactly until you want to know
     * what touches the document store.
     */
    imports?: (DynamicModule | ForwardReference | Type<unknown>)[];
    inject?: (InjectionToken | OptionalFactoryDependency)[];
    useFactory: (
      ...dependencies: never[]
    ) =>
      | { read: ReadClients; documents: ReceiveDocument }
      | Promise<{ read: ReadClients; documents: ReceiveDocument }>;
  }): DynamicModule {
    const PARTS = Symbol('CLIENT_PARTS');
    return {
      module: ClientsModule,
      imports: options.imports ?? [],
      controllers: [ClientsController, DocumentsController],
      providers: [
        {
          provide: PARTS,
          inject: options.inject ?? [],
          useFactory: options.useFactory as (...args: unknown[]) => unknown,
        },
        { provide: ReadClients, inject: [PARTS], useFactory: (p: { read: ReadClients }) => p.read },
        {
          provide: ReceiveDocument,
          inject: [PARTS],
          useFactory: (p: { documents: ReceiveDocument }) => p.documents,
        },
      ],
      exports: [ReadClients, ReceiveDocument],
    };
  }
}
