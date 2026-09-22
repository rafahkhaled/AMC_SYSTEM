import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import { ProjectWorkflow } from '../application/project-workflow.js';
import { ReadProjects } from '../application/read-projects.js';
import { ReadWorkload } from '../application/read-workload.js';
import { StartProject } from '../application/start-project.js';
import { ProjectsController } from './projects.controller.js';

interface Parts {
  read: ReadProjects;
  workflow: ProjectWorkflow;
  workload: ReadWorkload;
  start: StartProject;
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest identifies a dynamic module by its class
export class ProjectsModule {
  static forRootAsync(options: {
    inject?: (InjectionToken | OptionalFactoryDependency)[];
    useFactory: (...dependencies: never[]) => Parts | Promise<Parts>;
  }): DynamicModule {
    const PARTS = Symbol('PROJECT_PARTS');
    return {
      module: ProjectsModule,
      controllers: [ProjectsController],
      providers: [
        {
          provide: PARTS,
          inject: options.inject ?? [],
          useFactory: options.useFactory as (...args: unknown[]) => unknown,
        },
        { provide: ReadProjects, inject: [PARTS], useFactory: (p: Parts) => p.read },
        {
          provide: ProjectWorkflow,
          inject: [PARTS],
          useFactory: (p: Parts) => p.workflow,
        },
        { provide: ReadWorkload, inject: [PARTS], useFactory: (p: Parts) => p.workload },
        { provide: StartProject, inject: [PARTS], useFactory: (p: Parts) => p.start },
      ],
      exports: [ReadProjects, ProjectWorkflow, ReadWorkload],
    };
  }
}
