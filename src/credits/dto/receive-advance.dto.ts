import { IsDateString, IsEnum, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '@prisma/client';

export class ReceiveAdvanceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'Advance amount must be greater than zero' })
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  /**
   * Date the advance was actually received.
   * Accepts YYYY-MM-DD. Defaults to today if omitted.
   * Use this to backdate historical advance entries.
   */
  @IsDateString()
  @IsOptional()
  receivedAt?: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
