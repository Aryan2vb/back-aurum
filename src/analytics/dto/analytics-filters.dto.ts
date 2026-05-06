import { IsOptional, IsDateString, IsString, IsEnum } from 'class-validator';
import { InvoiceStatus, MetalType, PaymentMethod } from '@prisma/client';

export enum Granularity {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export class AnalyticsFiltersDto {
  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;

  @IsEnum(MetalType)
  @IsOptional()
  metalType?: MetalType;

  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus; // override default exclusion

  @IsString()
  @IsOptional()
  customerId?: string;

  @IsString()
  @IsOptional()
  hsnSac?: string;

  @IsString()
  @IsOptional()
  purity?: string;

  @IsString()
  @IsOptional()
  item?: string;

  @IsString()
  @IsOptional()
  location?: string;

  @IsEnum(PaymentMethod)
  @IsOptional()
  paymentMode?: PaymentMethod;

  @IsString()
  @IsOptional()
  createdById?: string;

  @IsEnum(Granularity)
  @IsOptional()
  granularity?: Granularity;
}
