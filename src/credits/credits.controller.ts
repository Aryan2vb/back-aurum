import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { CreateCreditDto } from './dto/create-credit.dto';
import { UpdateCreditDto } from './dto/update-credit.dto';
import { CreateCreditTransactionDto } from './dto/create-credit-transaction.dto';
import { UpdateCreditTransactionDto } from './dto/update-credit-transaction.dto';
import { QueryCreditsDto } from './dto/query-credits.dto';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { OrganizationRole } from '@prisma/client';

@Controller('credits')
export class CreditsController {
  private readonly logger = new Logger(CreditsController.name);

  constructor(private readonly creditsService: CreditsService) {
    this.logger.log('CreditsController initialized');
  }

  // ===========================
  // CREDITS
  // ===========================

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  create(@Body() createCreditDto: CreateCreditDto, @CurrentUser() user: CurrentUserData) {
    this.logger.log(`POST /credits - Creating credit for customer ${createCreditDto.customerId}`);
    return this.creditsService.create(createCreditDto, user);
  }

  @Get()
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  findAll(@Query() queryDto: QueryCreditsDto, @CurrentUser() user: CurrentUserData) {
    this.logger.debug(`GET /credits - Query: ${JSON.stringify(queryDto)}`);
    return this.creditsService.findAll(queryDto, user.organizationId);
  }

  @Get('stats')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  getStats(@CurrentUser() user: CurrentUserData) {
    this.logger.debug(`GET /credits/stats - Organization: ${user.organizationId}`);
    return this.creditsService.getStats(user.organizationId);
  }

  @Get('due-reminders')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  getDueReminders(@CurrentUser() user: CurrentUserData, @Query('days') days?: number) {
    this.logger.debug(`GET /credits/due-reminders - org: ${user.organizationId}, days: ${days}`);
    return this.creditsService.getDueReminders(user.organizationId, days ? Number(days) : 7);
  }

  @Get('customer/:customerId/summary')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  getCustomerCreditSummary(
    @Param('customerId') customerId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.creditsService.getCustomerCreditSummary(customerId, user.organizationId);
  }

  @Get(':id')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.creditsService.findOne(id, user.organizationId);
  }

  @Patch(':id')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  update(
    @Param('id') id: string,
    @Body() updateCreditDto: UpdateCreditDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.creditsService.update(id, updateCreditDto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(OrganizationRole.OWNER)
  softDelete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Query('force') force?: string,
  ) {
    const isForce = force === 'true';
    return this.creditsService.softDelete(id, user, isForce);
  }

  // ===========================
  // LEDGER & UDHAR
  // ===========================

  @Get('customer/:customerId/ledger')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  getCustomerLedger(@Param('customerId') customerId: string, @CurrentUser() user: CurrentUserData) {
    return this.creditsService.getCustomerLedger(customerId, user.organizationId);
  }

  @Get('customer/:customerId/udhar')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  getCustomerUdharEntries(
    @Param('customerId') customerId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.creditsService.getCustomerUdharEntries(customerId, user.organizationId);
  }

  // ===========================
  // TRANSACTIONS
  // ===========================

  @Get(':id/transactions')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  getTransactions(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.creditsService.getTransactions(id, user.organizationId);
  }

  @Post(':id/transactions')
  @HttpCode(HttpStatus.CREATED)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  addTransaction(
    @Param('id') id: string,
    @Body() createTransactionDto: CreateCreditTransactionDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    this.logger.log(
      `POST /credits/${id}/transactions - Adding payment: ${createTransactionDto.amount}`,
    );
    return this.creditsService.addTransaction(id, createTransactionDto, user);
  }

  @Patch(':creditId/transactions/:transactionId')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  updateTransaction(
    @Param('creditId') creditId: string,
    @Param('transactionId') transactionId: string,
    @Body() updateTransactionDto: UpdateCreditTransactionDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.creditsService.updateTransaction(
      creditId,
      transactionId,
      updateTransactionDto,
      user,
    );
  }

  @Delete(':creditId/transactions/:transactionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(OrganizationRole.OWNER)
  deleteTransaction(
    @Param('creditId') creditId: string,
    @Param('transactionId') transactionId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.creditsService.deleteTransaction(creditId, transactionId, user);
  }
}
