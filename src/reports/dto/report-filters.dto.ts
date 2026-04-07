import { IsOptional, IsDateString, IsString } from 'class-validator';

export class ReportFiltersDto {
  @IsDateString()
  @IsOptional()
  dateFrom?: string;

  @IsDateString()
  @IsOptional()
  dateTo?: string;

  @IsString()
  @IsOptional()
  customerId?: string;
}
