import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  Min,
  IsDateString,
  IsBoolean,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateInvoiceItemDto, CreateInvoicePaymentDto } from './create-invoice.dto';
import { INVOICE_TEMPLATE_INPUTS } from '../utils/invoice-template';

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

  /** Print format for this invoice: "standard" | "modern" | "jewellery" ("classic"/"default" = standard). */
  @IsIn(INVOICE_TEMPLATE_INPUTS as string[])
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

  @IsDateString()
  @IsOptional()
  invoiceDate?: string;

  @IsString()
  @IsOptional()
  buyerName?: string;

  @IsString()
  @IsOptional()
  buyerAddress?: string;

  @IsString()
  @IsOptional()
  buyerState?: string;

  @IsString()
  @IsOptional()
  buyerStateCode?: string;

  @IsOptional()
  @IsBoolean()
  autoCreateUdhar?: boolean;

  /**
   * Multi-payment split for draft updates.
   * When provided, these replace all existing payments on the draft.
   */
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoicePaymentDto)
  payments?: CreateInvoicePaymentDto[];
  @IsOptional()
  @IsBoolean()
  finalize?: boolean;

  /** Optional manual sequence number to override auto-increment while finalizing a draft. */
  @IsNumber()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  manualSequence?: number;
}
