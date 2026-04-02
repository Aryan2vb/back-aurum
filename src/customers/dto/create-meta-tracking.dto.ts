import { IsOptional, IsString, IsDateString } from 'class-validator';

export class CreateMetaTrackingDto {
  @IsOptional()
  @IsDateString()
  registeredOn?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  source?: string;
}
