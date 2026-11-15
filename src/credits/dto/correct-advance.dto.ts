import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CorrectAdvanceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @IsIn(['CREDIT', 'DEBIT'])
  direction: 'CREDIT' | 'DEBIT';

  @IsString()
  notes: string;

  @IsDateString()
  @IsOptional()
  transactionDate?: string;
}
