import { IsDateString, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ApplyAdvanceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'Amount must be greater than zero' })
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  /**
   * Date to record on the InvoicePayment row.
   * Defaults to today if omitted.
   * Should be the date the advance was originally received.
   */
  @IsDateString()
  @IsOptional()
  paidAt?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
