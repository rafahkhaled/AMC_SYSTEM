import type { Database } from '@amc/database';
import { Module } from '@nestjs/common';
import { ulid } from 'ulid';
import { DATABASE } from '../persistence/database.module.js';
import { ListsController } from './lists.controller.js';
import { ReferenceOptions } from './reference-options.repository.js';

@Module({
  controllers: [ListsController],
  providers: [
    {
      provide: ReferenceOptions,
      inject: [DATABASE],
      useFactory: (db: Database) => new ReferenceOptions(db, { next: () => ulid() }),
    },
  ],
  exports: [ReferenceOptions],
})
export class ListsModule {}
