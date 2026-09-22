import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import { ApproveTime } from '../application/approve-time.js';
import { ReadTimer } from '../application/read-timer.js';
import { TimerService } from '../application/timer-service.js';
import { TimerController } from './timer.controller.js';

/** What the composition root has to supply for the timer to work. */
export interface TimerParts {
  readonly timer: TimerService;
  readonly read: ReadTimer;
  readonly approvals: ApproveTime;
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest identifies a dynamic module by its class
export class TimerModule {
  static forRootAsync(options: {
    inject?: (InjectionToken | OptionalFactoryDependency)[];
    useFactory: (...dependencies: never[]) => TimerParts | Promise<TimerParts>;
  }): DynamicModule {
    const PARTS = Symbol('TIMER_PARTS');
    return {
      module: TimerModule,
      controllers: [TimerController],
      providers: [
        {
          provide: PARTS,
          inject: options.inject ?? [],
          useFactory: options.useFactory as (...args: unknown[]) => TimerParts,
        },
        {
          provide: TimerService,
          inject: [PARTS],
          useFactory: (parts: TimerParts) => parts.timer,
        },
        {
          provide: ReadTimer,
          inject: [PARTS],
          useFactory: (parts: TimerParts) => parts.read,
        },
        {
          provide: ApproveTime,
          inject: [PARTS],
          useFactory: (parts: TimerParts) => parts.approvals,
        },
      ],
      exports: [TimerService, ReadTimer, ApproveTime],
    };
  }
}
