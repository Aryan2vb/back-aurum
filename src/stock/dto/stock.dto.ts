import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { MetalType } from '@prisma/client';

export class CreatePurityDto {
  @IsEnum(MetalType)
  metalType: MetalType;

  @IsString()
  @IsNotEmpty()
  label: string;
}

export class UpdatePurityDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sortOrder?: number;
}

export class OpeningBalanceDto {
  @IsEnum(MetalType)
  metalType: MetalType;

  @IsString()
  @IsNotEmpty()
  purity: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  rate?: number;

  @IsOptional()
  @IsDateString()
  date?: string;
}
