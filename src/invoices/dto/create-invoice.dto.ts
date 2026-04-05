import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  ValidateNested,
  Min,
  IsDateString,
  IsPositive,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TaxType, MetalType } from '@prisma/client';

export class CreateInvoiceItemDto {
  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  hsnSac: string;

  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsString()
  @IsOptional()
  unit?: string; // defaults to 'PCS'

  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  makingCharges?: number; // display-only, per-unit making charge

  // Jewellery extras
  @IsNumber()
  @Min(0)
  @IsOptional()
  grossWeight?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  netWeight?: number;

  @IsString()
  @IsOptional()
  purity?: string;

  @IsString()
  @IsOptional()
  huid?: string;

  @IsEnum(MetalType)
  @IsOptional()
  metalType?: MetalType;
}

export class CreateInvoiceDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];

  /** Amount already paid at time of sale. Defaults to 0 (full Udhar). */
  @IsNumber()
  @Min(0)
  @IsOptional()
  paidAmount?: number;

  @IsEnum(TaxType)
  @IsOptional()
  taxType?: TaxType;

  /** GST rates — if omitted, defaults from OrgInvoiceSettings are used. */
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

  /** "standard" or "jewellery" — defaults from OrgInvoiceSettings if omitted. */
  @IsString()
  @IsOptional()
  templateType?: string;

  // Dispatch / delivery fields
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

  // Buyer address override (if different from customer's stored address)
  @IsString()
  @IsOptional()
  buyerAddress?: string;

  @IsString()
  @IsOptional()
  buyerState?: string;

  @IsString()
  @IsOptional()
  buyerStateCode?: string;

  /** Whether to automatically create an UdharEntry for unpaid balance. Defaults to true. */
  @IsOptional()
  @IsBoolean()
  autoCreateUdhar?: boolean;
}
