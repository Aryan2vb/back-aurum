import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  ValidateNested,
  Min,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TaxType } from '@prisma/client';
import { CreateInvoiceItemDto } from './create-invoice.dto';

export class UpdateInvoiceDto {
  @IsString()
  @IsOptional()
  customerId?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items?: CreateInvoiceItemDto[];

  @IsNumber()
  @Min(0)
  @IsOptional()
  paidAmount?: number;

  @IsEnum(TaxType)
  @IsOptional()
  taxType?: TaxType;

  @IsNumber()
  @Min(0)
  @IsOptional()
  cgstRate?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  sgstRate?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  igstRate?: number;

  @IsString()
  @IsOptional()
  templateType?: string;

  @IsString()
  @IsOptional()
  modeOfPayment?: string;

  @IsString()
  @IsOptional()
  deliveryNote?: string;

  @IsString()
  @IsOptional()
  dispatchDocNo?: string;

  @IsString()
  @IsOptional()
  destination?: string;

  @IsString()
  @IsOptional()
  termsOfDelivery?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsDateString()
  @IsOptional()
  invoiceDate?: string;

  @IsString()
  @IsOptional()
  buyerAddress?: string;

  @IsString()
  @IsOptional()
  buyerState?: string;

  @IsString()
  @IsOptional()
  buyerStateCode?: string;
}
