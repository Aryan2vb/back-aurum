import { IsNumber, IsOptional, IsDateString, IsEnum, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum PaymentMethod {
  CASH = 'CASH',
  UPI = 'UPI',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CHEQUE = 'CHEQUE',
  CARD = 'CARD',
  OTHER = 'OTHER',
}

export class CreateCreditTransactionDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'Payment amount must be greater than 0' })
  @Type(() => Number)
  amount: number;

  @IsOptional()
  @IsDateString()
  transactionDate?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  collectedBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
