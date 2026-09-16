import { type FileStorage, LocalFileStorage, S3FileStorage } from '@amc/storage';
import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { ENVIRONMENT, type Environment, encryptionKey } from '../config/env.js';
import { FilesController } from './files.controller.js';
import { FILE_STORAGE } from './tokens.js';

export { FILE_STORAGE };

/**
 * Where documents live, decided once at boot.
 *
 * Nothing below this line knows which it got. The local driver exists so the
 * storage path runs for real in development — same keys, same checksums, same
 * signed links — rather than being stubbed and first exercised in production.
 */
@Module({
  imports: [ConfigModule],
  controllers: [FilesController],
  providers: [
    {
      provide: FILE_STORAGE,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment): FileStorage =>
        environment.STORAGE_DRIVER === 's3'
          ? new S3FileStorage(
              new S3Client({ region: environment.STORAGE_REGION }),
              environment.STORAGE_BUCKET ?? '',
            )
          : new LocalFileStorage(environment.STORAGE_ROOT, encryptionKey(environment)),
    },
  ],
  exports: [FILE_STORAGE],
})
export class StorageModule {}
