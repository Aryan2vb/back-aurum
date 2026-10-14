import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { OrganizationRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';
import { FooterLibraryService } from './footer-library.service';
import {
  CreateFooterAssetUploadDto,
  CreateFooterFolderDto,
  UpdateFooterAssetDto,
} from './dto/invoice-footer.dto';

@Controller('invoice-footers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FooterLibraryController {
  constructor(private readonly service: FooterLibraryService) {}
  @Get() list(
    @CurrentUser() user: CurrentUserData,
    @Query('folderId') folderId?: string,
    @Query('tag') tag?: string,
  ) {
    return this.service.list(user.organizationId, folderId, tag);
  }
  @Post('folders')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  createFolder(@Body() dto: CreateFooterFolderDto, @CurrentUser() user: CurrentUserData) {
    return this.service.createFolder(user.organizationId, dto);
  }
  @Post('assets/presign')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  createUpload(@Body() dto: CreateFooterAssetUploadDto, @CurrentUser() user: CurrentUserData) {
    return this.service.createUpload(user.organizationId, dto);
  }
  @Post('assets/:id/complete')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  complete(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.service.completeUpload(user.organizationId, id);
  }
  @Patch('assets/:id')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFooterAssetDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.updateAsset(user.organizationId, id, dto);
  }
  @Post('assets/:id/default')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  setDefault(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.service.setDefault(user.organizationId, id);
  }
  @Post('assets/:id/archive')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  archive(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.service.archive(user.organizationId, id);
  }
  @Post('assets/:id/restore')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.service.restore(user.organizationId, id);
  }
}
