import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export const BANK_MATCH_KINDS = ['INVOICE_PAYMENT', 'FINANCIAL_TRANSACTION', 'PURCHASE_PAYMENT'] as const;
export const BANK_CREATE_KINDS = ['LOAN', 'CASH_DEPOSIT', 'ADVANCE', 'MONEY_OUT'] as const;

export class ConfirmBankStatementMatchDto {
  @IsUUID()
  paymentId: string;

  @IsOptional()
  @IsIn(BANK_MATCH_KINDS)
  kind?: (typeof BANK_MATCH_KINDS)[number];
}

export class ConfirmBankStatementMatchBulkDto {
  @IsUUID()
  paymentId: string;

  @IsOptional()
  @IsIn(BANK_MATCH_KINDS)
  kind?: (typeof BANK_MATCH_KINDS)[number];

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  lineIds: string[];
}

export class CreateAndMatchBankStatementDto {
  @IsIn(BANK_CREATE_KINDS)
  kind: (typeof BANK_CREATE_KINDS)[number];

  @IsOptional()
  @IsUUID()
  fromAccountId?: string;

  /** Required when kind is ADVANCE */
  @IsOptional()
  @IsUUID()
  customerId?: string;
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
