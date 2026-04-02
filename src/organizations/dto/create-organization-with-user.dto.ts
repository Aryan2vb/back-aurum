import { IsString, IsNotEmpty, IsEmail } from 'class-validator';

export class CreateOrganizationWithUserDto {
  @IsString()
  @IsNotEmpty()
  organizationName: string;

  @IsString()
  @IsNotEmpty()
  userId: string; // From Supabase Auth

  @IsEmail()
  @IsNotEmpty()
  userEmail: string;
}
