import { IsString, IsOptional, IsNumber, IsDateString, Min, IsBoolean } from 'class-validator';

export class FinalizeInvoiceDto {
  /**
   * Optional manual override for invoice number.
   * Useful for migrating legacy invoices.
   */
  @IsString()
  @IsOptional()
  manualInvoiceNumber?: string;

  /**
   * Amount paid at the time of finalization.
   * If omitted, the paidAmount from the draft is used.
   */
  @IsNumber()
  @Min(0)
  @IsOptional()
  paidAmount?: number;

  /**
   * Date of the invoice. Defaults to current date if omitted.
   */
  @IsDateString()
  @IsOptional()
  invoiceDate?: string;

  /**
   * Optional due date for the credit/udhar entry if balance remains.
   */
  @IsDateString()
  @IsOptional()
  dueDate?: string;

  /**
   * Optional notes for the ledger entry.
   */
  @IsString()
  @IsOptional()
  notes?: string;

  /**
   * Whether to automatically create an UdharEntry for unpaid balance. Defaults to true.
   */
  @IsOptional()
  autoCreateUdhar?: boolean;
}
