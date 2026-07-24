import { IsEnum, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '@prisma/client';

export class RefundAdvanceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'Refund amount must be greater than zero' })
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  accountId?: string;
}
