import { DrizzleUnitOfWork } from '@amc/audit/infrastructure';
import type { Database } from '@amc/database';
import { SystemClock } from '@amc/kernel';
import { Module } from '@nestjs/common';
import { ulid } from 'ulid';
import { DATABASE } from '../persistence/database.module.js';
import { BranchesController } from './branches.controller.js';
import { Branches } from './branches.repository.js';

@Module({
  controllers: [BranchesController],
  providers: [
    {
      provide: Branches,
      inject: [DATABASE],
      useFactory: (db: Database) =>
        new Branches(db, new DrizzleUnitOfWork(db, { next: () => ulid() }, new SystemClock())),
    },
  ],
  exports: [Branches],
})
export class BranchesModule {}
