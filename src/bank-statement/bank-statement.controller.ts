import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OrganizationRole } from '@prisma/client';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { BankStatementService } from './bank-statement.service';
import {
  ConfirmBankStatementMatchDto,
  ConfirmBankStatementMatchBulkDto,
  DeleteBankStatementLinesBulkDto,
} from './dto/bank-statement.dto';

const WRITE_ROLES = [OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.STAFF];

const READ_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.STAFF,
  OrganizationRole.VIEWER,
];

@Controller('finance/bank-statements')
export class BankStatementController {
  constructor(private readonly bankStatements: BankStatementService) {}

  @Post('accounts/:accountId/upload')
  @Roles(...WRITE_ROLES)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Param('accountId') accountId: string,
    @UploadedFile() file: { buffer?: Buffer; originalname?: string } | undefined,
    @CurrentUser() user: CurrentUserData,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Upload an HDFC delimited .txt statement file');
    }
    const text = file.buffer.toString('utf8');
    return this.bankStatements.upload(accountId, text, file.originalname || 'statement.txt', user);
  }

  @Get('inbox')
  @Roles(...READ_ROLES)
  listInbox(@CurrentUser() user: CurrentUserData, @Query('accountId') accountId?: string) {
    return this.bankStatements.listInbox(user.organizationId, accountId);
  }

  @Get('unmatched')
  @Roles(...READ_ROLES)
  listUnmatched(@CurrentUser() user: CurrentUserData, @Query('accountId') accountId?: string) {
    return this.bankStatements.listUnmatched(user.organizationId, accountId);
  }

  @Get('unmatched-payments')
  @Roles(...READ_ROLES)
  listUnmatchedPayments(
    @CurrentUser() user: CurrentUserData,
    @Query('accountId') accountId?: string,
  ) {
    return this.bankStatements.listUnmatchedPayments(user.organizationId, accountId);
  }

  @Get('matched')
  @Roles(...READ_ROLES)
  listMatched(@CurrentUser() user: CurrentUserData, @Query('accountId') accountId?: string) {
    return this.bankStatements.listMatched(user.organizationId, accountId);
  }

  @Post('lines/:id/ignore')
  @Roles(...WRITE_ROLES)
  ignore(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.bankStatements.ignore(id, user);
  }

  @Post('lines/:id/unmatch')
  @Roles(...WRITE_ROLES)
  unmatch(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.bankStatements.unmatch(id, user);
  }

  @Delete('lines/:id')
  @Roles(...WRITE_ROLES)
  deleteLine(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.bankStatements.deleteLine(id, user);
  }

  @Post('delete-bulk')
  @Roles(...WRITE_ROLES)
  deleteLinesBulk(
    @Body() dto: DeleteBankStatementLinesBulkDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.bankStatements.deleteLines(dto.lineIds, user);
  }

  @Post('lines/:id/match')
  @Roles(...WRITE_ROLES)
  confirmMatch(
    @Param('id') id: string,
    @Body() dto: ConfirmBankStatementMatchDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.bankStatements.confirmMatch(id, dto.paymentId, user);
  }

  @Post('match-bulk')
  @Roles(...WRITE_ROLES)
  confirmMatchBulk(
    @Body() dto: ConfirmBankStatementMatchBulkDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.bankStatements.confirmMatchMany(dto.lineIds, dto.paymentId, user);
  }
}
