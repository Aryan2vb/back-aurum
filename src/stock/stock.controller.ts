import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseEnumPipe,
} from '@nestjs/common';
import { StockService } from './stock.service';
import { MetalType, OrganizationRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';
import { CreatePurityDto, OpeningBalanceDto, StockDateRangeQueryDto, UpdatePurityDto } from './dto/stock.dto';

@Controller('stock')
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
    @Query('metalType', new ParseEnumPipe(MetalType, { optional: true })) metalType?: MetalType,
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
    @Query() query: StockDateRangeQueryDto,
  ) {
    return this.stockService.getGroupSummary(user.organizationId, query.startDate, query.endDate);
  }

  @Get('purities')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  async listPurities(
    @CurrentUser() user: CurrentUserData,
    @Query('includeInactive') includeInactive?: string,
  ) {
    const include =
      includeInactive === '1' || includeInactive === 'true' || includeInactive === 'yes';
    return this.stockService.listPurities(user.organizationId, include);
  }

  @Post('purities')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  async createPurity(@CurrentUser() user: CurrentUserData, @Body() body: CreatePurityDto) {
    return this.stockService.createPurity(user.organizationId, body.metalType, body.label);
  }

  @Patch('purities/:id')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  async updatePurity(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() body: UpdatePurityDto,
  ) {
    return this.stockService.updatePurity(user.organizationId, id, body);
  }

  @Delete('purities/:id')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  async hidePurity(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.stockService.hidePurity(user.organizationId, id);
  }

  @Post('opening-balance')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  async initializeOpeningBalance(
    @CurrentUser() user: CurrentUserData,
    @Body() data: OpeningBalanceDto,
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
