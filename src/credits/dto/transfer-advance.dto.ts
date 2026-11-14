import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TransferAdvanceDto {
  @IsUUID()
  toCustomerId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'Transfer amount must be greater than zero' })
  @Min(0.01)
  @Type(() => Number)
  amount: number;

  @IsDateString()
  @IsOptional()
  transactionDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
