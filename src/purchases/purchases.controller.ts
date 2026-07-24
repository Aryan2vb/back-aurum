import { Body, Controller, Delete, Get, Logger, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PurchasesService } from './purchases.service';
import { MetalType, OrganizationRole, PaymentMethod, TaxType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';
import { CreatePurchaseBillBookDto } from './dto/create-purchase-bill-book.dto';

type PurchaseBody = {
  vendorId?: string;
  vendorName?: string;
  invoiceNumber?: string;
  billSeries?: string;
  purchaseDate?: string;
  dueDate?: string;
  metalType?: MetalType;
  purity?: string;
  totalWeight?: number;
  rate?: number;
  totalAmount?: number;
  addGst?: boolean;
  gstInclusive?: boolean;
  taxType?: TaxType;
  cgstRate?: number;
  sgstRate?: number;
  igstRate?: number;
  notes?: string;
  attachmentUrl?: string | null;
  attachmentKey?: string | null;
  attachmentName?: string | null;
  attachmentMime?: string | null;
  items?: Array<{
    itemName?: string;
    metalType: MetalType;
    purity: string;
    grossWeight?: number;
    netWeight?: number;
    rate?: number;
  }>;
  payments?: Array<{
    mode: PaymentMethod;
    amount: number;
    paidAt?: string;
    reference?: string;
    notes?: string;
    accountId?: string;
  }>;
};

@Controller('purchases')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PurchasesController {
  private readonly logger = new Logger(PurchasesController.name);

  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  async createPurchase(
    @CurrentUser() user: CurrentUserData,
    @Body() data: PurchaseBody,
  ) {
    return this.purchasesService.createPurchase({
      ...data,
      organizationId: user.organizationId,
    });
  }

  @Patch(':id')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  async updatePurchase(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() data: PurchaseBody,
  ) {
    return this.purchasesService.updatePurchase(id, {
      ...data,
      organizationId: user.organizationId,
    });
  }

  /** Attachment-only update — never runs bill/item validation */
  @Patch(':id/attachment')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  async updateAttachment(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body()
    data: {
      attachmentUrl?: string | null;
      attachmentKey?: string | null;
      attachmentName?: string | null;
      attachmentMime?: string | null;
    },
  ) {
    return this.purchasesService.updateAttachment(id, user.organizationId, data);
  }

  @Post('bill-book')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  async getBillBook(
    @Body() dto: CreatePurchaseBillBookDto,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ) {
    this.logger.log(`POST /purchases/bill-book for org ${user.organizationId}`);
    const html = await this.purchasesService.generatePurchaseBillBook(dto, user.organizationId);
    res.set({ 'Content-Type': 'text/html; charset=utf-8' });
    res.send(html);
  }

  @Post(':id/payments')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  async recordPayment(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body()
    data: {
      amount: number;
      paymentMethod?: PaymentMethod;
      paidAt?: string;
      reference?: string;
      notes?: string;
      accountId?: string;
    },
  ) {
    return this.purchasesService.recordPayment(id, user.organizationId, data);
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

  @Get(':id')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  async getPurchase(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.purchasesService.getPurchase(id, user.organizationId);
  }

  @Delete(':id')
  @Roles(OrganizationRole.OWNER)
  async deletePurchase(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.purchasesService.deletePurchase(id, user.organizationId);
  }
}
