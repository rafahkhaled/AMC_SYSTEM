import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import { ReadTasks } from '../application/read-tasks.js';
import { ReadWorkload } from '../application/read-workload.js';
import { TaskWorkflow } from '../application/task-workflow.js';
import { TasksController } from './tasks.controller.js';

interface Parts {
  read: ReadTasks;
  workflow: TaskWorkflow;
  workload: ReadWorkload;
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest identifies a dynamic module by its class
export class TasksModule {
  static forRootAsync(options: {
    inject?: (InjectionToken | OptionalFactoryDependency)[];
    useFactory: (...dependencies: never[]) => Parts | Promise<Parts>;
  }): DynamicModule {
    const PARTS = Symbol('TASK_PARTS');
    return {
      module: TasksModule,
      controllers: [TasksController],
      providers: [
        {
          provide: PARTS,
          inject: options.inject ?? [],
          useFactory: options.useFactory as (...args: unknown[]) => unknown,
        },
        { provide: ReadTasks, inject: [PARTS], useFactory: (p: Parts) => p.read },
        {
          provide: TaskWorkflow,
          inject: [PARTS],
          useFactory: (p: Parts) => p.workflow,
        },
        { provide: ReadWorkload, inject: [PARTS], useFactory: (p: Parts) => p.workload },
      ],
      exports: [ReadTasks, TaskWorkflow, ReadWorkload],
    };
  }
}
