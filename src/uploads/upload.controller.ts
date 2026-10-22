import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  Post,
} from '@nestjs/common';
import { OrganizationRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, CurrentUserData } from '../auth/current-user.decorator';
import { UploadService } from './upload.service';
import { PresignUploadDto, DeleteUploadDto } from './dto/presign-upload.dto';
import { ASSET_CONFIG } from './asset-type.enum';
import { PrismaService } from '../prisma/prisma.service';

@Controller('uploads')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(
    private readonly uploadService: UploadService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /uploads/presign
   *
   * Returns a presigned PUT URL. Frontend uploads the file directly to R2
   * using this URL — the image never passes through the backend.
   *
   * After a successful upload, the frontend should save the returned `publicUrl`
   * via the relevant PATCH endpoint (e.g. PATCH /invoices/settings for logos).
   *
   * Roles: OWNER | ADMIN
   */
  @Post('presign')
  @HttpCode(HttpStatus.OK)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async presign(@Body() dto: PresignUploadDto, @CurrentUser() user: CurrentUserData) {
    this.logger.log(
      `POST /uploads/presign — assetType: ${dto.assetType}, org: ${user.organizationId}`,
    );

    const config = ASSET_CONFIG[dto.assetType];

    // Validate MIME type before generating presigned URL
    if (!config.allowedMimes.includes(dto.contentType)) {
      throw new BadRequestException(
        `Content type "${dto.contentType}" is not allowed for ${dto.assetType}. ` +
          `Allowed: ${config.allowedMimes.join(', ')}`,
      );
    }

    // Non-singleton types require an entityId for proper namespacing
    if (!config.singleton && !dto.entityId) {
      throw new BadRequestException(`entityId is required for asset type ${dto.assetType}`);
    }

    const result = await this.uploadService.presign(
      user.organizationId,
      dto.assetType,
      dto.contentType,
      dto.entityId,
    );

    return {
      presignedUrl: result.presignedUrl,
      publicUrl: result.publicUrl,
      key: result.key,
      expiresIn: result.expiresIn,
      maxBytes: config.maxBytes,
    };
  }

  /**
   * DELETE /uploads
   *
   * Deletes a specific R2 object by key.
   * Use this when the user removes an image (e.g. clears their logo).
   *
   * Roles: OWNER | ADMIN
   */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async deleteObject(@Body() dto: DeleteUploadDto, @CurrentUser() user: CurrentUserData) {
    this.logger.log(`DELETE /uploads — key: ${dto.key}, org: ${user.organizationId}`);

    // Ensure the key belongs to this org (security: prevent deleting other orgs' files)
    const expectedPrefix = `org/${user.organizationId}/`;
    if (!dto.key.startsWith(expectedPrefix)) {
      throw new BadRequestException('You do not have permission to delete this file');
    }

    const protectedFooter = await this.prisma.invoiceFooterAsset.findFirst({
      where: { r2Key: dto.key, organizationId: user.organizationId },
      include: {
        invoices: { select: { id: true }, take: 1 },
      },
    });
    if (protectedFooter && protectedFooter.invoices.length) {
      throw new BadRequestException(
        'This footer is referenced by an invoice and cannot be deleted. Archive it instead.',
      );
    }
    if (protectedFooter) {
      throw new BadRequestException(
        'Invoice footer assets are immutable. Archive the footer instead of deleting its R2 object.',
      );
    }

    await this.uploadService.deleteObject(dto.key);
  }
}
