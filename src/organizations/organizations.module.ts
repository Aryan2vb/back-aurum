import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { AuthModule } from '../auth/auth.module';
import { AccessPolicyModule } from './access-policy.module';

@Module({
  imports: [AuthModule, AccessPolicyModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService, AccessPolicyModule],
})
export class OrganizationsModule {}
