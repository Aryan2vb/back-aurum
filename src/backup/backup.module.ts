import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AccessPolicyModule } from '../organizations/access-policy.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AccessPolicyModule,
  ],
  controllers: [BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
