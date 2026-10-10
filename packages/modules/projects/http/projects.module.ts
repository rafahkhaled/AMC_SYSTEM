import {
  type DynamicModule,
  type InjectionToken,
  Module,
  type OptionalFactoryDependency,
} from '@nestjs/common';
import { ContinueWork } from '../application/continue-work.js';
import { ManageServices } from '../application/manage-services.js';
import type { ServiceCatalogue } from '../application/ports.js';
import { ProjectWorkflow } from '../application/project-workflow.js';
import { ReadProjects } from '../application/read-projects.js';
import { ReadWorkload } from '../application/read-workload.js';
import { StartProject } from '../application/start-project.js';
import { ProjectsController } from './projects.controller.js';
import { ServicesController } from './services.controller.js';
import { ServiceCatalogueToken } from './tokens.js';

interface Parts {
  read: ReadProjects;
  workflow: ProjectWorkflow;
  workload: ReadWorkload;
  start: StartProject;
  services: ManageServices;
  continuing: ContinueWork;
  catalogue: ServiceCatalogue;
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
      controllers: [ProjectsController, ServicesController],
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
        { provide: ContinueWork, inject: [PARTS], useFactory: (p: Parts) => p.continuing },
        { provide: ManageServices, inject: [PARTS], useFactory: (p: Parts) => p.services },
        {
          provide: ServiceCatalogueToken,
          inject: [PARTS],
          useFactory: (p: Parts) => p.catalogue,
        },
      ],
      exports: [ReadProjects, ProjectWorkflow, ReadWorkload],
    };
  }
}
