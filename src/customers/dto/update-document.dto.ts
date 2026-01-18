import { IsOptional, IsString, IsBoolean, Length } from 'class-validator';

export class UpdateDocumentDto {
    @IsOptional()
    @IsString()
    @Length(4, 4, { message: 'aadharLast4 must be exactly 4 digits' })
    aadharLast4?: string;

    @IsOptional()
    @IsBoolean()
    aadharVerified?: boolean;
}
