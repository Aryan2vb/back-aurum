import { IsNumber, IsPositive, IsString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class NegotiatePreviewQueryDto {
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  targetAmount: number;
}

export class NegotiateCommitDto {
  @IsNumber()
  @IsPositive()
  targetAmount: number;

  @IsString()
  @IsOptional()
  negotiationNote?: string;
}
