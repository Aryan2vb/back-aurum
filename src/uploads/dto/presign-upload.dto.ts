import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { AssetType, ASSET_CONFIG } from '../asset-type.enum';

export class PresignUploadDto {
  @IsEnum(AssetType)
  assetType: AssetType;

  @IsString()
  contentType: string;

  /**
   * Required for non-singleton asset types (e.g. JEWELLERY_PHOTO, CUSTOMER_DOC)
   * to namespace files under a specific entity (itemId, customerId, etc.)
   */
  @IsOptional()
  @IsString()
  entityId?: string;

  /**
   * Validate that the provided contentType is allowed for the given assetType.
   * Called manually in service after DTO validation passes.
   */
  isContentTypeAllowed(): boolean {
    const config = ASSET_CONFIG[this.assetType];
    return config?.allowedMimes.includes(this.contentType) ?? false;
  }
}

export class DeleteUploadDto {
  /** The R2 object key returned from presign (e.g. org/abc123/logo.png) */
  @IsString()
  key: string;
}
