import { Body, Controller, Get, Param, ParseEnumPipe, Patch, Post, Query } from '@nestjs/common';
import { FinancialAccountType, OrganizationRole } from '@prisma/client';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import {
  AssignMovementDto,
  BulkAssignMovementsDto,
  CreateFinancialAccountDto,
  CreateManualTransactionDto,
  UpdateFinancialAccountDto,
} from './dto/finance.dto';
import { FinanceService } from './finance.service';

const ALL_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.STAFF,
  OrganizationRole.VIEWER,
];

@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('accounts')
  @Roles(...ALL_ROLES)
  listAccounts(@CurrentUser() user: CurrentUserData) {
    return this.finance.listAccounts(user.organizationId);
  }

  @Get('accounts/:id')
  @Roles(...ALL_ROLES)
  getAccount(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.finance.getAccount(id, user.organizationId);
  }

  @Get('accounts/:id/ledger')
  @Roles(...ALL_ROLES)
  getAccountLedger(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.finance.getAccountLedger(user.organizationId, id, { dateFrom, dateTo });
  }

  @Get('books')
  @Roles(...ALL_ROLES)
  getBook(
    @CurrentUser() user: CurrentUserData,
    @Query('type', new ParseEnumPipe(FinancialAccountType)) type: FinancialAccountType,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.finance.getBook(user.organizationId, type, { dateFrom, dateTo });
  }

  @Get('unassigned')
  @Roles(...ALL_ROLES)
  getUnassigned(@CurrentUser() user: CurrentUserData) {
    return this.finance.getUnassignedMovements(user.organizationId);
  }

  @Post('accounts')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  createAccount(@Body() dto: CreateFinancialAccountDto, @CurrentUser() user: CurrentUserData) {
    return this.finance.createAccount(dto, user);
  }

  @Patch('accounts/:id')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  updateAccount(
    @Param('id') id: string,
    @Body() dto: UpdateFinancialAccountDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.finance.updateAccount(id, dto, user);
  }

  @Get('transactions')
  @Roles(...ALL_ROLES)
  listTransactions(
    @CurrentUser() user: CurrentUserData,
    @Query('accountId') accountId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.finance.listTransactions(user.organizationId, { accountId, from, to });
  }

  @Post('transactions')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF)
  createTransaction(@Body() dto: CreateManualTransactionDto, @CurrentUser() user: CurrentUserData) {
    return this.finance.createManualTransaction(dto, user);
  }

  @Post('transactions/:id/reverse')
  @Roles(OrganizationRole.OWNER)
  reverseTransaction(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.finance.reverseTransaction(id, user);
  }

  @Patch('movements/:id/account')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  assignMovement(
    @Param('id') id: string,
    @Body() dto: AssignMovementDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.finance.assignMovement(id, dto.accountId, user.organizationId);
  }

  @Post('movements/assign-bulk')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  bulkAssign(@Body() dto: BulkAssignMovementsDto, @CurrentUser() user: CurrentUserData) {
    return this.finance.bulkAssignMovements(dto, user.organizationId);
  }
}
