import { IsOptional, IsString, IsEnum, IsDateString, IsBoolean, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CreditStatus } from '@prisma/client';

export class QueryCreditsDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsEnum(CreditStatus)
  status?: CreditStatus;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  overdueOnly?: boolean;

  @IsOptional()
  @IsDateString()
  dueBefore?: string;

  @IsOptional()
  @IsDateString()
  dueAfter?: string;

  @IsOptional()
  @IsDateString()
  creditDateFrom?: string;

  @IsOptional()
  @IsDateString()
  creditDateTo?: string;

  @IsOptional()
  @IsString()
  search?: string;

  // Pagination
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number = 20;

  // Sorting
  @IsOptional()
  @IsString()
  sortBy?: string = 'creditDate';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
