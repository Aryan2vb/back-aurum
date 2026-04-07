import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsDateString,
  IsEnum,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReminderFrequency } from '@prisma/client';

export class CreateCreditDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'Total amount must be greater than 0' })
  @Type(() => Number)
  totalAmount: number;

  @IsOptional()
  @IsString()
  saleReference?: string;

  @IsOptional()
  @IsString()
  itemSummary?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  creditDate?: string;

  @IsOptional()
  @IsDateString()
  expectedDueDate?: string;

  @IsOptional()
  @IsEnum(ReminderFrequency)
  reminderFrequency?: ReminderFrequency;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'Initial payment cannot be negative' })
  @Type(() => Number)
  initialPayment?: number;

  @IsOptional()
  @IsString()
  invoiceId?: string;
}
