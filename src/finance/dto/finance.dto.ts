import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { FinancialAccountStatus, FinancialTransactionType } from '@prisma/client';

export class CreateFinancialAccountDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(['CASH', 'BANK'])
  type: 'CASH' | 'BANK';

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  ifsc?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  openingBalance?: number;

  @IsOptional()
  @IsDateString()
  openingDate?: string;
}

export class UpdateFinancialAccountDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsIn([FinancialAccountStatus.ACTIVE, FinancialAccountStatus.INACTIVE])
  status?: FinancialAccountStatus;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  ifsc?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  openingBalance?: number;

  @IsOptional()
  @IsDateString()
  openingDate?: string;
}

const MANUAL_TRANSACTION_TYPES = [
  FinancialTransactionType.CASH_BANK_TRANSFER,
  FinancialTransactionType.BANK_BANK_TRANSFER,
  FinancialTransactionType.ADJUSTMENT,
] as const;

export class CreateManualTransactionDto {
  @IsIn(MANUAL_TRANSACTION_TYPES)
  type: (typeof MANUAL_TRANSACTION_TYPES)[number];

  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  amount: number;

  @IsOptional()
  @IsString()
  fromAccountId?: string;

  @IsOptional()
  @IsString()
  toAccountId?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  reference?: string;
}

export class AssignMovementDto {
  @IsString()
  @IsNotEmpty()
  accountId: string;
}

export class BulkMovementAssignmentItemDto {
  @IsString()
  movementId: string;

  @IsString()
  accountId: string;
}

export class BulkAssignMovementsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkMovementAssignmentItemDto)
  assignments: BulkMovementAssignmentItemDto[];
}

export class FinanceDateRangeQueryDto {
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  accountId?: string;
}
