import { InvoiceStatus } from '@prisma/client';
import { IsArray, IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateBillBookDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  invoiceIds?: string[];

  @IsString()
  @IsOptional()
  search?: string;

  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus;

  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;
}
