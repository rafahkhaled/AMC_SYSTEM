import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import { ReadTasks } from '../application/read-tasks.js';
import { TaskWorkflow } from '../application/task-workflow.js';
import { TasksController } from './tasks.controller.js';

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest identifies a dynamic module by its class
export class TasksModule {
  static forRootAsync(options: {
    inject?: (InjectionToken | OptionalFactoryDependency)[];
    useFactory: (...dependencies: never[]) =>
      | { read: ReadTasks; workflow: TaskWorkflow }
      | Promise<{
          read: ReadTasks;
          workflow: TaskWorkflow;
        }>;
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
        { provide: ReadTasks, inject: [PARTS], useFactory: (p: { read: ReadTasks }) => p.read },
        {
          provide: TaskWorkflow,
          inject: [PARTS],
          useFactory: (p: { workflow: TaskWorkflow }) => p.workflow,
        },
      ],
      exports: [ReadTasks, TaskWorkflow],
    };
  }
}
