import { IsOptional, IsString, IsDateString } from 'class-validator';

export class UpdateMetaTrackingDto {
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
