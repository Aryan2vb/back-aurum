import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Patch,
  Delete,
  Param,
  Logger,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { AccessPolicyService } from './access-policy.service';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateAccessPolicyDto } from './dto/update-access-policy.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';
import { OrganizationRole } from '@prisma/client';

@Controller('organizations')
export class OrganizationsController {
  private readonly logger = new Logger(OrganizationsController.name);

  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly accessPolicy: AccessPolicyService,
  ) {
    this.logger.log('OrganizationsController initialized');
  }

  // ── Access policy (OWNER) ────────────────────────────────────────────────

  @Get('access-policy')
  @Roles(OrganizationRole.OWNER)
  getAccessPolicy(@CurrentUser() user: CurrentUserData) {
    return this.accessPolicy.getPolicyView(user.organizationId, user.role);
  }

  @Patch('access-policy')
  @Roles(OrganizationRole.OWNER)
  updateAccessPolicy(@Body() dto: UpdateAccessPolicyDto, @CurrentUser() user: CurrentUserData) {
    return this.accessPolicy.upsert(user.organizationId, dto);
  }

  // ── Members ──────────────────────────────────────────────────────────────

  @Post('members')
  @HttpCode(HttpStatus.CREATED)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  addMember(@Body() dto: AddMemberDto, @CurrentUser() user: CurrentUserData) {
    return this.organizationsService.addMember(dto, user);
  }

  @Get('members')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  getMembers(@CurrentUser() user: CurrentUserData) {
    return this.organizationsService.getMembers(user);
  }

  @Patch('members/:userId/role')
  @Roles(OrganizationRole.OWNER)
  changeMemberRole(
    @Param('userId') userId: string,
    @Body('role') role: OrganizationRole,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.organizationsService.changeMemberRole(userId, role, user);
  }

  @Delete('members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(OrganizationRole.OWNER)
  removeMember(@Param('userId') userId: string, @CurrentUser() user: CurrentUserData) {
    return this.organizationsService.removeMember(userId, user);
  }

  // ── Organization Lifecycle ────────────────────────────────────────────────

  /**
   * DELETE /organizations
   *
   * Soft-deletes the organization — sets deletedAt + status INACTIVE.
   * R2 files are preserved during the grace period (hard-delete is internal only).
   * Only OWNER can trigger this.
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  @Roles(OrganizationRole.OWNER)
  softDelete(@CurrentUser() user: CurrentUserData) {
    this.logger.warn(`DELETE /organizations — soft-delete by owner ${user.userId}`);
    return this.organizationsService.softDeleteOrg(user);
  }
}
