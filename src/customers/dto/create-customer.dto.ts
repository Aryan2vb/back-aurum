import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Gender } from '@prisma/client';
import { CreateContactDetailDto } from './create-contact-detail.dto';
import { CreateLocationDto } from './create-location.dto';

export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @IsOptional()
  gstin?: string;

  @IsString()
  @IsOptional()
  fatherName?: string;

  @IsString()
  @IsOptional()
  motherName?: string;

  @IsString()
  @IsOptional()
  spouseName?: string;

  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @IsBoolean()
  @IsOptional()
  isDobEstimated?: boolean;

  @ValidateNested()
  @Type(() => CreateContactDetailDto)
  @IsOptional()
  contactDetails?: CreateContactDetailDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateLocationDto)
  @IsOptional()
  locations?: CreateLocationDto[];
}
