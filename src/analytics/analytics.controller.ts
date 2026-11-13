import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsFiltersDto } from './dto/analytics-filters.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrganizationRole } from '@prisma/client';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard/summary')
  getDashboardSummary(
    @Query() filters: AnalyticsFiltersDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getDashboardSummary(user.organizationId, filters);
  }

  @Get('sales/trend')
  getSalesTrend(
    @Query() filters: AnalyticsFiltersDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getSalesTrend(user.organizationId, filters);
  }

  @Get('metal')
  getMetalAnalytics(
    @Query() filters: AnalyticsFiltersDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getMetalAnalytics(user.organizationId, filters);
  }

  @Get('payments')
  getPaymentAnalytics(
    @Query() filters: AnalyticsFiltersDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getPaymentAnalytics(user.organizationId, filters);
  }

  @Get('gst-hsn')
  getGstHsnAnalytics(
    @Query() filters: AnalyticsFiltersDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getGstHsnAnalytics(user.organizationId, filters);
  }

  @Get('customers')
  getTopCustomers(
    @Query() filters: AnalyticsFiltersDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getTopCustomers(user.organizationId, filters);
  }

  @Get('items')
  getTopItems(
    @Query() filters: AnalyticsFiltersDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getTopItems(user.organizationId, filters);
  }

  @Get('locations')
  getLocationAnalytics(
    @Query() filters: AnalyticsFiltersDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getLocationAnalytics(user.organizationId, filters);
  }

  @Get('labour')
  getLabourAnalytics(
    @Query() filters: AnalyticsFiltersDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getLabourAnalytics(user.organizationId, filters);
  }

  @Get('rates')
  getRateAnalytics(
    @Query() filters: AnalyticsFiltersDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getRateAnalytics(user.organizationId, filters);
  }

  @Get('inventory-movement')
  getInventoryMovement(
    @Query() filters: AnalyticsFiltersDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getInventoryMovement(user.organizationId, filters);
  }

  @Get('data-quality')
  getDataQuality(
    @Query() filters: AnalyticsFiltersDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getDataQuality(user.organizationId, filters);
  }

  @Get('users')
  getUserAnalytics(
    @Query() filters: AnalyticsFiltersDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.analyticsService.getUserAnalytics(user.organizationId, filters);
  }
}
