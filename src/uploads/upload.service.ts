import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { AssetType, ASSET_CONFIG } from './asset-type.enum';

export interface PresignResult {
  /** Presigned PUT URL — frontend uploads directly to R2 with this */
  presignedUrl: string;
  /** Public CDN URL to store in DB and use in PDFs */
  publicUrl: string;
  /** R2 object key — store this to be able to delete later */
  key: string;
  /** When the presigned PUT URL expires (seconds from now) */
  expiresIn: number;
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;
  private readonly presignTtl = 900; // 15 minutes

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.getOrThrow<string>('R2_ENDPOINT');
    const region = this.config.get<string>('R2_REGION', 'auto');
    const accessKeyId = this.config.getOrThrow<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.getOrThrow<string>('R2_SECRET_ACCESS_KEY');

    this.bucket = this.config.getOrThrow<string>('R2_BUCKET');
    const rawPublicUrl = this.config.getOrThrow<string>('R2_PUBLIC_URL');
    this.publicUrl = rawPublicUrl.trim().replace(/\/$/, '');

    this.client = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      // Cloudflare R2 works most reliably with path-style addressing
      forcePathStyle: true,
      // Disable checksums to prevent signature mismatch in browser fetch
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });

    this.logger.log(`UploadService initialized — bucket: ${this.bucket}`);
  }

  /**
   * Generates a presigned PUT URL for direct browser-to-R2 upload.
   * The image never passes through your backend.
   *
   * @param orgId       - Organization ID (used for key namespacing)
   * @param assetType   - Type of asset being uploaded
   * @param contentType - MIME type of the file (validated against ASSET_CONFIG)
   * @param entityId    - Optional entity ID for non-singleton assets (e.g. jewellery item ID)
   */
  async presign(
    orgId: string,
    assetType: AssetType,
    contentType: string,
    entityId?: string,
  ): Promise<PresignResult> {
    const assetConfig = ASSET_CONFIG[assetType];

    // Validate MIME type
    if (!assetConfig.allowedMimes.includes(contentType)) {
      throw new BadRequestException(
        `Content type "${contentType}" is not allowed for ${assetType}. ` +
          `Allowed: ${assetConfig.allowedMimes.join(', ')}`,
      );
    }

    // Build the object key
    const key = this.buildKey(orgId, assetType, contentType, entityId);

    // Generate presigned PUT URL
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      // Ensure no checksum is added to signed headers
      ChecksumAlgorithm: undefined,
    });

    let presignedUrl: string;
    try {
      presignedUrl = await getSignedUrl(this.client, command, {
        expiresIn: this.presignTtl,
      });
    } catch (err) {
      this.logger.error('Failed to generate presigned URL', err);
      throw new InternalServerErrorException('Failed to generate upload URL');
    }

    const publicUrl = `${this.publicUrl}/${key}`;

    this.logger.debug(`Presigned URL generated — key: ${key}, org: ${orgId}`);

    return {
      presignedUrl,
      publicUrl,
      key,
      expiresIn: this.presignTtl,
    };
  }

  /**
   * Deletes a single object from R2 by key.
   * Safe to call with a non-existent key (R2 returns 204 regardless).
   */
  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      this.logger.debug(`Deleted R2 object: ${key}`);
    } catch (err) {
      this.logger.error(`Failed to delete R2 object: ${key}`, err);
      // Non-fatal — caller decides whether to throw
      throw err;
    }
  }

  /**
   * Purges ALL objects under an org's R2 prefix: org/{orgId}/
   * Called during permanent org deletion (hard-delete, after grace period).
   *
   * Uses paginated ListObjectsV2 + batch DeleteObjects (max 1000 per batch).
   * Best-effort — logs errors but does not throw (doesn't block DB delete).
   */
  async purgeOrgFolder(orgId: string): Promise<void> {
    const prefix = `org/${orgId}/`;
    this.logger.log(`Purging R2 folder for org: ${orgId} (prefix: ${prefix})`);

    let deleted = 0;
    let continuationToken: string | undefined;

    try {
      do {
        const listOutput: ListObjectsV2CommandOutput = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );

        const objects = listOutput.Contents ?? [];

        if (objects.length > 0) {
          await this.client.send(
            new DeleteObjectsCommand({
              Bucket: this.bucket,
              Delete: {
                Objects: objects.map((o) => ({ Key: o.Key! })),
                Quiet: true,
              },
            }),
          );
          deleted += objects.length;
        }

        continuationToken = listOutput.IsTruncated ? listOutput.NextContinuationToken : undefined;
      } while (continuationToken);

      this.logger.log(`Purged ${deleted} R2 objects for org: ${orgId}`);
    } catch (err) {
      this.logger.error(`R2 folder purge failed for org: ${orgId}`, err);
      throw err; // caller wraps in .catch() to make it non-fatal
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private buildKey(
    orgId: string,
    assetType: AssetType,
    contentType: string,
    entityId?: string,
  ): string {
    const config = ASSET_CONFIG[assetType];
    const ext = this.mimeToExt(contentType);

    // Resolve folder template
    const folder = config.folder
      .replace('{orgId}', orgId)
      .replace('{entityId}', entityId ?? 'default');

    if (config.singleton) {
      // Singleton: use a fixed name without extension (logo, qr, etc.)
      // This ensures a true overwrite even if the user changes file format (e.g. png -> jpg)
      const typeName = assetType.toLowerCase().replace(/_/g, '').replace('org', '');
      return `${folder}/${typeName}`;
    } else {
      // Non-singleton: unique key per upload
      return `${folder}/${randomUUID()}.${ext}`;
    }
  }

  private mimeToExt(contentType: string): string {
    const map: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
    };
    return map[contentType] ?? 'bin';
  }
}
