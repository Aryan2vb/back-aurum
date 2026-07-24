import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import { MetalType, OrganizationRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';

@Controller('purchases')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  async createPurchase(
    @CurrentUser() user: CurrentUserData,
    @Body()
    data: {
      vendorId?: string;
      vendorName?: string;
      invoiceNumber?: string;
      billSeries?: string;
      purchaseDate?: string;
      dueDate?: string;
      metalType: MetalType;
      purity: string;
      totalWeight: number;
      rate?: number;
      totalAmount?: number;
      addGst?: boolean;
      gstInclusive?: boolean;
      cgstRate?: number;
      sgstRate?: number;
      notes?: string;
      items?: Array<{
        itemName?: string;
        metalType: MetalType;
        purity: string;
        grossWeight?: number;
        netWeight?: number;
        rate?: number;
      }>;
    },
  ) {
    return this.purchasesService.createPurchase({
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
  async getPurchases(@CurrentUser() user: CurrentUserData) {
    return this.purchasesService.getPurchases(user.organizationId);
  }
}
