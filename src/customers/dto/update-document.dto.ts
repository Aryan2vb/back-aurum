import { IsOptional, IsString, IsBoolean, Matches } from 'class-validator';

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{12}$/, { message: 'aadharNumber must be exactly 12 digits' })
  aadharNumber?: string;

  @IsOptional()
  @IsBoolean()
  aadharVerified?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, {
    message: 'panNumber must be a valid PAN format (e.g. ABCDE1234F)',
  })
  panNumber?: string;

  @IsOptional()
  @IsBoolean()
  panVerified?: boolean;
}
