import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ConfirmBankStatementMatchDto {
  @IsUUID()
  paymentId: string;
}

export class ListBankStatementLinesDto {
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
