import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AdvanceAllocationDto } from './advance-allocation.dto';

/**
 * Two shapes are accepted:
 *  - receipt-level: `{ allocations: [{ advanceEntryId, sourceCustomerId, amount }] }`
 *  - legacy lump-sum: `{ amount, paidAt?, notes? }`
 */
export class ApplyAdvanceDto {
  @ValidateIf((o) => !o.allocations)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'Amount must be greater than zero' })
  @Min(0.01)
  @Type(() => Number)
  amount?: number;

  @IsArray()
  @IsOptional()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdvanceAllocationDto)
  allocations?: AdvanceAllocationDto[];

  /**
   * Date to record on the InvoicePayment row (legacy shape only).
   * Defaults to today if omitted.
   */
  @IsDateString()
  @IsOptional()
  paidAt?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
