import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ContactMethod, PhoneOwnerType } from '@prisma/client';

export class CreateContactDetailDto {
  @IsString()
  @IsNotEmpty()
  primaryPhone: string;

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
