import { Global, Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';
import { AuthModule } from '../auth/auth.module';

/**
 * Global so any module can inject UploadService without re-importing.
 * e.g. OrganizationsModule injects it for org-delete R2 cleanup.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
