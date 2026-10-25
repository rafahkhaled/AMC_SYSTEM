import { DrizzleUnitOfWork } from '@amc/audit/infrastructure';
import type { Database } from '@amc/database';
import { SystemClock } from '@amc/kernel';
import { Module } from '@nestjs/common';
import { ulid } from 'ulid';
import { DATABASE } from '../persistence/database.module.js';
import { ProjectAssignmentsController } from './assignments.controller.js';
import { ProjectAssignments } from './assignments.js';

@Module({
  controllers: [ProjectAssignmentsController],
  providers: [
    {
      provide: ProjectAssignments,
      inject: [DATABASE],
      useFactory: (db: Database) =>
        new ProjectAssignments(
          new DrizzleUnitOfWork(db, { next: () => ulid() }, new SystemClock()),
          { next: () => ulid() },
        ),
    },
  ],
})
export class ProjectAssignmentsModule {}
