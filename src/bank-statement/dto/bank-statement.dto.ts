import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ConfirmBankStatementMatchDto {
  @IsUUID()
  invoiceId: string;
}

export class ListBankStatementLinesDto {
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
