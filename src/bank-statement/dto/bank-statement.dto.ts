import { ArrayMinSize, IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class ConfirmBankStatementMatchDto {
  @IsUUID()
  paymentId: string;
}

export class ConfirmBankStatementMatchBulkDto {
  @IsUUID()
  paymentId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  lineIds: string[];
}

export class DeleteBankStatementLinesBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  lineIds: string[];
}

export class ListBankStatementLinesDto {
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
