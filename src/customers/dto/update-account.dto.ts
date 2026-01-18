import { IsOptional, IsNumber, IsDateString, IsEnum } from 'class-validator';
import { AccountStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class UpdateAccountDto {
    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Type(() => Number)
    openingBalance?: number;

    @IsOptional()
    @IsDateString()
    openedAt?: string;

    @IsOptional()
    @IsEnum(AccountStatus)
    status?: AccountStatus;
}
