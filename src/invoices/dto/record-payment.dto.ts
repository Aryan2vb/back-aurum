import { IsNumber, IsPositive, IsOptional, IsEnum, IsString, IsDateString } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class RecordPaymentDto {
    @IsNumber()
    @IsPositive()
    amount: number;

    @IsEnum(PaymentMethod)
    @IsOptional()
    paymentMethod?: PaymentMethod;

    @IsString()
    @IsOptional()
    referenceNumber?: string;

    @IsString()
    @IsOptional()
    collectedBy?: string;

    @IsString()
    @IsOptional()
    notes?: string;

    @IsDateString()
    @IsOptional()
    transactionDate?: string;
}
