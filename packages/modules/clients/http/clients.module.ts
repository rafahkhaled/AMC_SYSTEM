import {
  type DynamicModule,
  type ForwardReference,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
  type Type,
} from '@nestjs/common';
import { ClientVault } from '../application/client-vault.js';
import { ContactLog } from '../application/contact-log.js';
import { GenerateLetter } from '../application/generate-letter.js';
import { LeadWorkflow } from '../application/lead-workflow.js';
import { ReadClients } from '../application/read-clients.js';
import { ReadLeads } from '../application/read-leads.js';
import { ReceiveDocument } from '../application/receive-document.js';
import { ClientsController } from './clients.controller.js';
import { ContactLogController } from './contact-log.controller.js';
import { DocumentsController } from './documents.controller.js';
import { LeadsController } from './leads.controller.js';
import { LettersController } from './letters.controller.js';
import { VaultController } from './vault.controller.js';

interface Parts {
  read: ReadClients;
  documents: ReceiveDocument;
  vault: ClientVault;
  contactLog: ContactLog;
  leads: ReadLeads;
  leadWorkflow: LeadWorkflow;
  letters: GenerateLetter;
}

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
    useFactory: (...dependencies: never[]) => Parts | Promise<Parts>;
  }): DynamicModule {
    const PARTS = Symbol('CLIENT_PARTS');
    return {
      module: ClientsModule,
      imports: options.imports ?? [],
      controllers: [
        ClientsController,
        ContactLogController,
        DocumentsController,
        LeadsController,
        LettersController,
        VaultController,
      ],
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
        {
          provide: ClientVault,
          inject: [PARTS],
          useFactory: (p: Parts) => p.vault,
        },
        {
          provide: ContactLog,
          inject: [PARTS],
          useFactory: (p: Parts) => p.contactLog,
        },
        { provide: ReadLeads, inject: [PARTS], useFactory: (p: Parts) => p.leads },
        { provide: LeadWorkflow, inject: [PARTS], useFactory: (p: Parts) => p.leadWorkflow },
        { provide: GenerateLetter, inject: [PARTS], useFactory: (p: Parts) => p.letters },
      ],
      exports: [
        ReadClients,
        ReceiveDocument,
        ClientVault,
        ContactLog,
        ReadLeads,
        LeadWorkflow,
        GenerateLetter,
      ],
    };
  }
}
