import { IsEmail, IsEnum, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { OrganizationRole } from '@prisma/client';

export class AddMemberDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsEnum(OrganizationRole)
  role: OrganizationRole;
}
