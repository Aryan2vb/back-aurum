import { IsNumber, IsString, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** One advance receipt (or part of it) used to pay an invoice. */
export class AdvanceAllocationDto {
  /** The ADVANCE_RECEIVED / ADVANCE_TRANSFER_IN ledger entry being consumed. */
  @IsUUID()
  advanceEntryId: string;

  /** Owner of the receipt — may differ from the invoice customer. */
  @IsString()
  sourceCustomerId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  amount: number;
}
