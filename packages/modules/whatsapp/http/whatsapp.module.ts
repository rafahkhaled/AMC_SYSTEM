import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import type { WebhookGateway } from '../application/ports.js';
import { ReadConversations } from '../application/read-conversations.js';
import { ReceiveMessage } from '../application/receive-message.js';
import { RecordDelivery } from '../application/record-delivery.js';
import { SendMessage } from '../application/send-message.js';
import { WEBHOOK_GATEWAY, WhatsAppWebhookController } from './webhook.controller.js';
import { WhatsAppController } from './whatsapp.controller.js';

/** What the composition root has to supply for this module to work. */
export interface WhatsAppParts {
  readonly conversations: ReadConversations;
  readonly send: SendMessage;
  readonly receive: ReceiveMessage;
  readonly deliveries: RecordDelivery;
  readonly gateway: WebhookGateway;
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest identifies a dynamic module by its class
export class WhatsAppModule {
  /**
   * Wired from the API, which owns every adapter.
   *
   * The parts arrive built rather than being assembled here, for the reason the
   * other modules do it: this package must not know that there is a Postgres or
   * a Meta on the other side of its ports, and a module that constructs its own
   * repositories has already decided both.
   */
  static forRootAsync(options: {
    inject?: (InjectionToken | OptionalFactoryDependency)[];
    useFactory: (...dependencies: never[]) => WhatsAppParts | Promise<WhatsAppParts>;
  }): DynamicModule {
    const PARTS = Symbol('amc.whatsapp.parts');

    return {
      module: WhatsAppModule,
      controllers: [WhatsAppController, WhatsAppWebhookController],
      providers: [
        {
          provide: PARTS,
          inject: options.inject ?? [],
          useFactory: options.useFactory as (...args: unknown[]) => WhatsAppParts,
        },
        {
          provide: ReadConversations,
          inject: [PARTS],
          useFactory: (p: WhatsAppParts) => p.conversations,
        },
        { provide: SendMessage, inject: [PARTS], useFactory: (p: WhatsAppParts) => p.send },
        { provide: ReceiveMessage, inject: [PARTS], useFactory: (p: WhatsAppParts) => p.receive },
        {
          provide: RecordDelivery,
          inject: [PARTS],
          useFactory: (p: WhatsAppParts) => p.deliveries,
        },
        { provide: WEBHOOK_GATEWAY, inject: [PARTS], useFactory: (p: WhatsAppParts) => p.gateway },
      ],
      exports: [ReadConversations, SendMessage, ReceiveMessage, RecordDelivery],
    };
  }
}
