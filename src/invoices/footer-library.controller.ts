import { Body, Controller, Get, Header, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { createHash } from 'crypto';
import { OrganizationRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';
import { FooterLibraryService } from './footer-library.service';
import {
  CreateFooterAssetUploadDto,
  CreateFooterFolderDto,
  UpdateFooterAssetDto,
} from './dto/invoice-footer.dto';

@Controller('invoice-footers')
export class FooterLibraryController {
  constructor(private readonly service: FooterLibraryService) {}
  @Get()
  @Header('Cache-Control', 'private, max-age=30, must-revalidate')
  async list(
    @CurrentUser() user: CurrentUserData,
    @Res({ passthrough: true }) res: Response,
    @Query('folderId') folderId?: string,
    @Query('tag') tag?: string,
  ) {
    const data = await this.service.list(user.organizationId, folderId, tag);

    // Content-addressed ETag so repeated opens (slideover / page switch) can
    // return 304 Not Modified instead of re-sending the whole payload.
    const etag = `"${createHash('sha1').update(JSON.stringify(data)).digest('base64url')}"`;
    res.setHeader('ETag', etag);
    if (res.req.headers['if-none-match'] === etag) {
      res.status(304);
      return undefined;
    }
    return data;
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
