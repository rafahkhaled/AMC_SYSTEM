import { DrizzleUnitOfWork } from '@amc/audit/infrastructure';
import type { Database } from '@amc/database';
import { SystemClock } from '@amc/kernel';
import { Module } from '@nestjs/common';
import { ulid } from 'ulid';
import { DATABASE } from '../persistence/database.module.js';
import { CampaignsController } from './campaigns.controller.js';
import { Campaigns } from './campaigns.repository.js';

@Module({
  controllers: [CampaignsController],
  providers: [
    {
      provide: Campaigns,
      inject: [DATABASE],
      useFactory: (db: Database) =>
        new Campaigns(db, new DrizzleUnitOfWork(db, { next: () => ulid() }, new SystemClock()), {
          next: () => ulid(),
        }),
    },
  ],
  exports: [Campaigns],
})
export class CampaignsModule {}
