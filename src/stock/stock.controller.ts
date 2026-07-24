import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { StockService } from './stock.service';
import { MetalType, OrganizationRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';

@Controller('stock')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get('balances')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  async getBalances(@CurrentUser() user: CurrentUserData) {
    return this.stockService.getBalances(user.organizationId);
  }

  @Get('ledger')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  async getLedger(
    @CurrentUser() user: CurrentUserData,
    @Query('metalType') metalType?: MetalType,
    @Query('purity') purity?: string,
  ) {
    return this.stockService.getLedger(user.organizationId, metalType, purity);
  }

  @Get('group-summary')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  async getGroupSummary(
    @CurrentUser() user: CurrentUserData,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.stockService.getGroupSummary(user.organizationId, startDate, endDate);
  }

  @Post('opening-balance')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  async initializeOpeningBalance(
    @CurrentUser() user: CurrentUserData,
    @Body()
    data: {
      metalType: MetalType;
      purity: string;
      quantity: number;
      rate?: number;
      date?: string;
    },
  ) {
    return this.stockService.initializeOpeningBalance(
      user.organizationId,
      data.metalType,
      data.purity,
      data.quantity,
      data.rate,
      data.date,
    );
  }
}
