import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceFooterAssetStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UploadService } from '../uploads/upload.service';
import { CreateFooterAssetUploadDto, CreateFooterFolderDto, UpdateFooterAssetDto } from './dto/invoice-footer.dto';

@Injectable()
export class FooterLibraryService {
  constructor(private readonly prisma: PrismaService, private readonly uploads: UploadService) {}

  async list(organizationId: string, folderId?: string, tag?: string) {
    await this.ensureLegacyFooter(organizationId);
    const assets = await this.prisma.invoiceFooterAsset.findMany({
      where: {
        organizationId,
        status: { not: InvoiceFooterAssetStatus.PENDING },
        ...(folderId ? { folderId } : {}),
        ...(tag ? { tags: { has: tag } } : {}),
      },
      include: { folder: true },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
    const folders = await this.prisma.invoiceFooterFolder.findMany({
      where: { organizationId }, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return { folders, assets };
  }

  async createFolder(organizationId: string, dto: CreateFooterFolderDto) {
    return this.prisma.invoiceFooterFolder.create({ data: { organizationId, name: dto.name.trim() } });
  }

  async createUpload(organizationId: string, dto: CreateFooterAssetUploadDto) {
    if (dto.folderId) await this.folderForOrg(dto.folderId, organizationId);
    const tags = this.cleanTags(dto.tags);
    const asset = await this.prisma.invoiceFooterAsset.create({
      data: {
        organizationId,
        folderId: dto.folderId || null,
        name: dto.name?.trim() || 'Untitled footer',
        tags,
        contentType: dto.contentType,
        r2Key: `pending/${randomUUID()}`,
        publicUrl: '',
      },
    });
    try {
      const upload = await this.uploads.presignInvoiceFooterAsset(organizationId, asset.id, dto.contentType);
      await this.prisma.invoiceFooterAsset.updateMany({
        where: { id: asset.id, organizationId }, data: { r2Key: upload.key, publicUrl: upload.publicUrl },
      });
      return { assetId: asset.id, ...upload };
    } catch (error) {
      await this.prisma.invoiceFooterAsset.deleteMany({ where: { id: asset.id, organizationId } });
      throw error;
    }
  }

  async completeUpload(organizationId: string, assetId: string) {
    const asset = await this.assetForOrg(assetId, organizationId);
    if (asset.status !== InvoiceFooterAssetStatus.PENDING) return asset;
    if (!asset.r2Key.startsWith(`org/${organizationId}/invoice-footer-assets/`)) {
      throw new BadRequestException('Footer upload is not ready for completion');
    }
    try {
      const head = await this.uploads.getObjectMetadata(asset.r2Key);
      await this.prisma.invoiceFooterAsset.updateMany({
        where: { id: assetId, organizationId },
        data: { status: InvoiceFooterAssetStatus.ACTIVE, byteSize: Number(head.ContentLength || 0) },
      });
      return this.prisma.invoiceFooterAsset.findFirst({ where: { id: assetId, organizationId }, include: { folder: true } });
    } catch {
      throw new BadRequestException('Footer file was not uploaded or is no longer available');
    }
  }

  async updateAsset(organizationId: string, assetId: string, dto: UpdateFooterAssetDto) {
    const asset = await this.assetForOrg(assetId, organizationId);
    if (dto.folderId) await this.folderForOrg(dto.folderId, organizationId);
    await this.prisma.invoiceFooterAsset.updateMany({
      where: { id: asset.id, organizationId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.folderId !== undefined ? { folderId: dto.folderId || null } : {}),
        ...(dto.tags !== undefined ? { tags: this.cleanTags(dto.tags) } : {}),
        ...(dto.displayOrder !== undefined ? { displayOrder: dto.displayOrder } : {}),
      },
    });
    return this.prisma.invoiceFooterAsset.findFirst({ where: { id: asset.id, organizationId }, include: { folder: true } });
  }

  async setDefault(organizationId: string, assetId: string) {
    const asset = await this.assetForOrg(assetId, organizationId);
    if (asset.status !== InvoiceFooterAssetStatus.ACTIVE) throw new BadRequestException('Only active footers can be default');
    return this.prisma.$transaction(async (tx) => {
      await tx.invoiceFooterAsset.updateMany({ where: { organizationId }, data: { isDefault: false } });
      await tx.invoiceFooterAsset.updateMany({ where: { id: assetId, organizationId }, data: { isDefault: true } });
      return tx.invoiceFooterAsset.findFirst({ where: { id: assetId, organizationId } });
    });
  }

  async archive(organizationId: string, assetId: string) {
    const asset = await this.assetForOrg(assetId, organizationId);
    return this.prisma.$transaction(async (tx) => {
      if (asset.isDefault) await tx.invoiceFooterAsset.updateMany({ where: { organizationId }, data: { isDefault: false } });
      await tx.invoiceFooterAsset.updateMany({
        where: { id: assetId, organizationId },
        data: { status: InvoiceFooterAssetStatus.ARCHIVED, archivedAt: new Date(), isDefault: false },
      });
      return tx.invoiceFooterAsset.findFirst({ where: { id: assetId, organizationId } });
    });
  }

  async restore(organizationId: string, assetId: string) {
    const asset = await this.assetForOrg(assetId, organizationId);
    if (asset.status !== InvoiceFooterAssetStatus.ARCHIVED) {
      throw new BadRequestException('Only archived footers can be restored');
    }
    await this.prisma.invoiceFooterAsset.updateMany({
      where: { id: assetId, organizationId },
      data: { status: InvoiceFooterAssetStatus.ACTIVE, archivedAt: null },
    });
    return this.prisma.invoiceFooterAsset.findFirst({ where: { id: assetId, organizationId }, include: { folder: true } });
  }

  private async assetForOrg(id: string, organizationId: string) {
    const asset = await this.prisma.invoiceFooterAsset.findFirst({ where: { id, organizationId } });
    if (!asset) throw new NotFoundException('Footer asset not found');
    return asset;
  }
  private async folderForOrg(id: string, organizationId: string) {
    const folder = await this.prisma.invoiceFooterFolder.findFirst({ where: { id, organizationId } });
    if (!folder) throw new NotFoundException('Footer folder not found');
    return folder;
  }
  private cleanTags(tags?: string[]) { return [...new Set((tags || []).map((tag) => tag.trim()).filter(Boolean))].slice(0, 12); }

  /** Make the old singleton URL selectable once, without moving or deleting its R2 object. */
  private async ensureLegacyFooter(organizationId: string) {
    const [settings, assetCount] = await Promise.all([
      this.prisma.orgInvoiceSettings.findUnique({ where: { organizationId } }),
      this.prisma.invoiceFooterAsset.count({ where: { organizationId } }),
    ]);
    if (!settings?.footerImageUrl || assetCount) return;
    let r2Key = `legacy/${organizationId}/footer`;
    try { r2Key = new URL(settings.footerImageUrl).pathname.replace(/^\//, ''); } catch { /* retain deterministic legacy key */ }
    await this.prisma.invoiceFooterAsset.create({
      data: {
        organizationId,
        name: 'Legacy footer',
        tags: ['legacy'],
        r2Key,
        publicUrl: settings.footerImageUrl,
        contentType: 'image/*',
        status: InvoiceFooterAssetStatus.ACTIVE,
        isDefault: true,
      },
    }).catch(() => undefined);
  }
}
