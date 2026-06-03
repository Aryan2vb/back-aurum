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
import { MetalType, MakingChargesType, PaymentMethod } from '@prisma/client';

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

  // Metal Details (Raw Inputs)
  @IsEnum(MetalType)
  @IsNotEmpty()
  metalType: MetalType;

  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  metalRate: number; // ₹/gm at 24K or 999 fine

  @IsString()
  @IsOptional()
  purityLabel?: string; // e.g. "22K", "18K", "925"

  @IsNumber()
  @Min(0)
  @IsOptional()
  purityValue?: number; // e.g. 22.00, 18.00, 92.50

  @IsNumber()
  @IsOptional()
  purityBasis?: number; // 24 or 1000

  // Weight Details
  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  grossWeight: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  stoneWeight?: number = 0;

  // Making Charges
  @IsNumber()
  @Min(0)
  @IsOptional()
  makingCharges?: number;

  @IsEnum(MakingChargesType)
  @IsOptional()
  makingChargesType?: MakingChargesType = MakingChargesType.PER_GRAM;

  // Additional Charges
  @IsNumber()
  @Min(0)
  @IsOptional()
  stoneCharges?: number = 0;

  @IsBoolean()
  @IsOptional()
  isHallmarked?: boolean = false;

  @IsNumber()
  @Min(0)
  @IsOptional()
  hallmarkingCharge?: number;

  @IsString()
  @IsOptional()
  huid?: string;
}

export class CreateInvoicePaymentDto {
  @IsEnum(PaymentMethod)
  @IsNotEmpty()
  mode: PaymentMethod;

  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  amount: number;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateInvoiceDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];

  @IsString()
  @IsOptional()
  metalRateSource?: string; // "IBJA" | "MCX" | "MANUAL"

  @IsDateString()
  @IsOptional()
  metalRateDate?: string;

  /** Amount already paid at time of sale. Defaults to 0 (full Udhar). */
  @IsNumber()
  @Min(0)
  @IsOptional()
  paidAmount?: number;

  /** Multi-payment split. If provided, overrides/populates paidAmount. */
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoicePaymentDto)
  payments?: CreateInvoicePaymentDto[];

  /** "standard" or "jewellery" — defaults to "jewellery" for this module. */
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

  @IsOptional()
  @IsBoolean()
  finalize?: boolean;

  /** Optional manual sequence number to override auto-increment. */
  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  manualSequence?: number;
}
