import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OrganizationRole } from '@prisma/client';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BankStatementService } from './bank-statement.service';
import { ConfirmBankStatementMatchDto } from './dto/bank-statement.dto';

const WRITE_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.STAFF,
];

@Controller('finance/bank-statements')
@UseGuards(JwtAuthGuard, RolesGuard)
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

  @Get('unmatched')
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.STAFF,
    OrganizationRole.VIEWER,
  )
  listUnmatched(
    @CurrentUser() user: CurrentUserData,
    @Query('accountId') accountId?: string,
  ) {
    return this.bankStatements.listUnmatched(user.organizationId, accountId);
  }

  @Post('lines/:id/ignore')
  @Roles(...WRITE_ROLES)
  ignore(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.bankStatements.ignore(id, user);
  }

  @Post('lines/:id/match')
  @Roles(...WRITE_ROLES)
  confirmMatch(
    @Param('id') id: string,
    @Body() dto: ConfirmBankStatementMatchDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.bankStatements.confirmMatch(id, dto.invoiceId, user);
  }
}
