import { IsString, IsNotEmpty, IsEmail } from 'class-validator';

/**
 * For testing/development when you don't have Supabase running
 * Creates a user with auto-generated ID
 */
export class SignupWithoutUserDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  organizationName: string;
}




