import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import { ReadClients } from '../application/read-clients.js';
import { ClientsController } from './clients.controller.js';

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest identifies a dynamic module by its class
export class ClientsModule {
  static forRootAsync(options: {
    inject?: (InjectionToken | OptionalFactoryDependency)[];
    useFactory: (...dependencies: never[]) => ReadClients | Promise<ReadClients>;
  }): DynamicModule {
    return {
      module: ClientsModule,
      controllers: [ClientsController],
      providers: [
        {
          provide: ReadClients,
          inject: options.inject ?? [],
          useFactory: options.useFactory as (...args: unknown[]) => ReadClients,
        },
      ],
      exports: [ReadClients],
    };
  }
}
