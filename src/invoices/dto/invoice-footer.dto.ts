import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateFooterFolderDto {
  @IsString() @MaxLength(80) name: string;
}

export class CreateFooterAssetUploadDto {
  @IsString() contentType: string;
  @IsString() @IsOptional() @MaxLength(120) name?: string;
  @IsString() @IsOptional() folderId?: string;
  @IsArray() @IsString({ each: true }) @IsOptional() tags?: string[];
}

export class UpdateFooterAssetDto {
  @IsString() @IsOptional() @MaxLength(120) name?: string;
  @IsString() @IsOptional() folderId?: string | null;
  @IsArray() @IsString({ each: true }) @IsOptional() tags?: string[];
  @IsInt() @Min(0) @Type(() => Number) @IsOptional() displayOrder?: number;
}
