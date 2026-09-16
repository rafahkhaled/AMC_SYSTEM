import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import { ReadTimer } from '../application/read-timer.js';
import { TimerService } from '../application/timer-service.js';
import { TimerController } from './timer.controller.js';

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest identifies a dynamic module by its class
export class TimerModule {
  static forRootAsync(options: {
    inject?: (InjectionToken | OptionalFactoryDependency)[];
    useFactory: (
      ...dependencies: never[]
    ) =>
      | { timer: TimerService; read: ReadTimer }
      | Promise<{ timer: TimerService; read: ReadTimer }>;
  }): DynamicModule {
    const PARTS = Symbol('TIMER_PARTS');
    return {
      module: TimerModule,
      controllers: [TimerController],
      providers: [
        {
          provide: PARTS,
          inject: options.inject ?? [],
          useFactory: options.useFactory as (...args: unknown[]) => {
            timer: TimerService;
            read: ReadTimer;
          },
        },
        {
          provide: TimerService,
          inject: [PARTS],
          useFactory: (parts: { timer: TimerService }) => parts.timer,
        },
        {
          provide: ReadTimer,
          inject: [PARTS],
          useFactory: (parts: { read: ReadTimer }) => parts.read,
        },
      ],
      exports: [TimerService, ReadTimer],
    };
  }
}
