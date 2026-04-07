import {
  IsEnum,
  IsOptional,
  IsString,
  IsDateString,
  IsInt,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { InvoiceStatus } from '@prisma/client';

export class QueryInvoicesDto {
  @IsString()
  @IsOptional()
  customerId?: string;

  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;

  @IsString()
  @IsOptional()
  search?: string; // matches invoiceNumber or customer name

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  includeItems?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;

  @IsString()
  @IsOptional()
  sortBy?: string = 'invoiceDate';

  @IsString()
  @IsOptional()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
