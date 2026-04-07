import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportFiltersDto } from './dto/report-filters.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrganizationRole } from '@prisma/client';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  getSalesSummary(@Query() filters: ReportFiltersDto, @CurrentUser() user: CurrentUserData) {
    return this.reportsService.getSalesSummary(user.organizationId, filters);
  }

  @Get('gst')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  getGstReport(@Query() filters: ReportFiltersDto, @CurrentUser() user: CurrentUserData) {
    return this.reportsService.getGstReport(user.organizationId, filters);
  }

  @Get('collections')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  getCollectionsReport(@Query() filters: ReportFiltersDto, @CurrentUser() user: CurrentUserData) {
    return this.reportsService.getCollectionsReport(user.organizationId, filters);
  }

  @Get('outstanding')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  getOutstandingDues(@CurrentUser() user: CurrentUserData) {
    return this.reportsService.getOutstandingDues(user.organizationId);
  }

  @Get('inventory-flow')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  getInventoryFlow(@Query() filters: ReportFiltersDto, @CurrentUser() user: CurrentUserData) {
    return this.reportsService.getInventoryFlow(user.organizationId, filters);
  }

  @Get('customer-statement/:id')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  getCustomerStatement(@Param('id') customerId: string, @CurrentUser() user: CurrentUserData) {
    return this.reportsService.getCustomerStatement(user.organizationId, customerId);
  }
}
