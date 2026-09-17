import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import { ReadInbox } from '../application/read-inbox.js';
import { InboxController } from './inbox.controller.js';

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest identifies a dynamic module by its class
export class NotificationsModule {
  static forRootAsync(options: {
    inject?: (InjectionToken | OptionalFactoryDependency)[];
    useFactory: (...dependencies: never[]) => ReadInbox | Promise<ReadInbox>;
  }): DynamicModule {
    return {
      module: NotificationsModule,
      controllers: [InboxController],
      providers: [
        {
          provide: ReadInbox,
          inject: options.inject ?? [],
          useFactory: options.useFactory as (...args: unknown[]) => ReadInbox,
        },
      ],
      exports: [ReadInbox],
    };
  }
}
