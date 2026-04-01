import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsDecimal,
    IsEnum,
    IsNumber,
    IsPositive,
    Min,
} from 'class-validator';
import { TaxType } from '@prisma/client';

export class CreateOrgInvoiceSettingsDto {
    @IsString()
    @IsNotEmpty()
    companyName: string;

    @IsString()
    @IsNotEmpty()
    address: string;

    @IsString()
    @IsNotEmpty()
    gstin: string;

    @IsString()
    @IsNotEmpty()
    state: string;

    @IsString()
    @IsNotEmpty()
    stateCode: string;

    @IsString()
    @IsOptional()
    phone?: string;

    @IsString()
    @IsOptional()
    email?: string;

    @IsString()
    @IsOptional()
    pan?: string;

    @IsString()
    @IsOptional()
    mantra?: string;

    @IsString()
    @IsOptional()
    logoUrl?: string;

    @IsString()
    @IsOptional()
    bisLogoUrl?: string;

    // Bank details
    @IsString()
    @IsOptional()
    bankName?: string;

    @IsString()
    @IsOptional()
    bankBranch?: string;

    @IsString()
    @IsOptional()
    bankAccountName?: string;

    @IsString()
    @IsOptional()
    bankAccountNumber?: string;

    @IsString()
    @IsOptional()
    bankIfsc?: string;

    // Invoice defaults
    @IsEnum(TaxType)
    @IsOptional()
    defaultTaxType?: TaxType;

    @IsNumber()
    @Min(0)
    @IsOptional()
    defaultCgstRate?: number;

    @IsNumber()
    @Min(0)
    @IsOptional()
    defaultSgstRate?: number;

    @IsNumber()
    @Min(0)
    @IsOptional()
    defaultIgstRate?: number;

    @IsString()
    @IsOptional()
    defaultTemplate?: string;

    @IsString()
    @IsOptional()
    declaration?: string;

    @IsString()
    @IsOptional()
    termsOfDelivery?: string;
}
