import { IsNumber, IsPositive, IsString, IsOptional, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { NegotiationMode } from '../utils/invoice-negotiation.service';
import { MetalType } from '@prisma/client';

export class NegotiatePreviewQueryDto {
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  targetAmount: number;

  @IsEnum(NegotiationMode)
  @IsOptional()
  mode?: NegotiationMode = NegotiationMode.MAKING_CHARGES;

  @IsEnum(MetalType)
  @IsOptional()
  metalType?: MetalType;
}

export class NegotiateCommitDto {
  @IsNumber()
  @IsPositive()
  targetAmount: number;

  @IsEnum(NegotiationMode)
  @IsOptional()
  mode?: NegotiationMode = NegotiationMode.MAKING_CHARGES;

  @IsEnum(MetalType)
  @IsOptional()
  metalType?: MetalType;

  @IsString()
  @IsOptional()
  negotiationNote?: string;
}
