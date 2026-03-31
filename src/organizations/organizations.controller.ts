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
  UseGuards,
  Logger,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { AddMemberDto } from './dto/add-member.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';
import { OrganizationRole } from '@prisma/client';

@Controller('organizations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganizationsController {
  private readonly logger = new Logger(OrganizationsController.name);

  constructor(private readonly organizationsService: OrganizationsService) {
    this.logger.log('OrganizationsController initialized');
  }

  @Post('members')
  @HttpCode(HttpStatus.CREATED)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  addMember(@Body() dto: AddMemberDto, @CurrentUser() user: CurrentUserData) {
    return this.organizationsService.addMember(dto, user);
  }

  @Get('members')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
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
  removeMember(
    @Param('userId') userId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.organizationsService.removeMember(userId, user);
  }
}

