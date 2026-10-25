import { DrizzleUnitOfWork } from '@amc/audit/infrastructure';
import type { Database } from '@amc/database';
import { SystemClock } from '@amc/kernel';
import { Module } from '@nestjs/common';
import { ulid } from 'ulid';
import { DATABASE } from '../persistence/database.module.js';
import { ClassificationController } from './classification.controller.js';
import { ClassificationService } from './classification.js';

@Module({
  controllers: [ClassificationController],
  providers: [
    {
      provide: ClassificationService,
      inject: [DATABASE],
      useFactory: (db: Database) =>
        new ClassificationService(
          db,
          new DrizzleUnitOfWork(db, { next: () => ulid() }, new SystemClock()),
        ),
    },
  ],
})
export class ClassificationModule {}
