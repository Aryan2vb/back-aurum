import { Controller, Post, Get, Patch, Body, Param } from '@nestjs/common';
import { VendorsService } from './vendors.service';
import { OrganizationRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';

@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Post()
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  async createVendor(
    @CurrentUser() user: CurrentUserData,
    @Body()
    data: {
      name: string;
      phone?: string;
      email?: string;
      gstin?: string;
      address?: string;
      stateCode?: string;
      stateName?: string;
    },
  ) {
    return this.vendorsService.createVendor({
      ...data,
      organizationId: user.organizationId,
    });
  }

  @Get()
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  async getVendors(@CurrentUser() user: CurrentUserData) {
    return this.vendorsService.getVendors(user.organizationId);
  }

  @Patch(':id')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  async updateVendor(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Body()
    data: {
      name?: string;
      phone?: string;
      email?: string;
      gstin?: string;
      address?: string;
      stateCode?: string;
      stateName?: string;
    },
  ) {
    return this.vendorsService.updateVendor(id, user.organizationId, data);
  }
}
