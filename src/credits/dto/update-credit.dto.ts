import {
    IsString,
    IsOptional,
    IsNumber,
    IsDateString,
    IsEnum,
    Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReminderFrequency, CreditStatus } from '@prisma/client';

export class UpdateCreditDto {
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
    @IsDateString()
    nextReminderDate?: string;

    @IsOptional()
    @IsEnum(CreditStatus)
    status?: CreditStatus;

    @IsOptional()
    @IsString()
    notes?: string;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0.01, { message: 'Total amount must be greater than 0' })
    @Type(() => Number)
    totalAmount?: number;
}
