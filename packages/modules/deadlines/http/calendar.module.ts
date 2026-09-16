import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import { ReadCalendar } from '../application/read-calendar.js';
import { CalendarController } from './calendar.controller.js';

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest identifies a dynamic module by its class
export class CalendarModule {
  static forRootAsync(options: {
    inject?: (InjectionToken | OptionalFactoryDependency)[];
    useFactory: (...dependencies: never[]) => ReadCalendar | Promise<ReadCalendar>;
  }): DynamicModule {
    return {
      module: CalendarModule,
      controllers: [CalendarController],
      providers: [
        {
          provide: ReadCalendar,
          inject: options.inject ?? [],
          useFactory: options.useFactory as (...args: unknown[]) => ReadCalendar,
        },
      ],
      exports: [ReadCalendar],
    };
  }
}
