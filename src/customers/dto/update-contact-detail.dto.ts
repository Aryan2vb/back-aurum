import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ContactMethod, PhoneOwnerType } from '@prisma/client';

export class UpdateContactDetailDto {
  @IsString()
  @IsOptional()
  primaryPhone?: string;

  @IsString()
  @IsOptional()
  secondaryPhone?: string;

  @IsEnum(PhoneOwnerType)
  @IsOptional()
  phoneOwnerType?: PhoneOwnerType;

  @IsEnum(ContactMethod)
  @IsOptional()
  preferredContactMethod?: ContactMethod;
}
