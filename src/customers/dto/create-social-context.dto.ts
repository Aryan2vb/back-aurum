import { IsOptional, IsString, IsEnum } from 'class-validator';
import { IncomeRange } from '@prisma/client';

export class CreateSocialContextDto {
  @IsOptional()
  @IsString()
  caste?: string;

  @IsOptional()
  @IsString()
  educationLevel?: string;

  @IsOptional()
  @IsString()
  occupation?: string;

  @IsOptional()
  @IsEnum(IncomeRange)
  incomeRange?: IncomeRange;
}
