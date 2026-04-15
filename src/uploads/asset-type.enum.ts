/**
 * AssetType enum + ASSET_CONFIG
 *
 * Adding a new upload type (e.g. jewellery photo, barcode):
 *   1. Add a new key to AssetType
 *   2. Add its config row to ASSET_CONFIG
 *   Done — no other code changes needed.
 */

export enum AssetType {
  // ─── Org-level branding (invoice / PDF) ────────────────────────────────
  ORG_LOGO = 'ORG_LOGO',
  ORG_BIS_LOGO = 'ORG_BIS_LOGO',
  ORG_QR_CODE = 'ORG_QR_CODE',
  ORG_SIGNATURE = 'ORG_SIGNATURE',

  // ─── Future: jewellery tag photos ──────────────────────────────────────
  JEWELLERY_PHOTO = 'JEWELLERY_PHOTO',

  // ─── Future: barcode / label images ────────────────────────────────────
  BARCODE_LABEL = 'BARCODE_LABEL',

  // ─── Future: customer KYC documents (should be private presigned) ───────
  CUSTOMER_DOC = 'CUSTOMER_DOC',
}

export interface AssetConfig {
  /** Folder template. {orgId} and {entityId} are replaced at runtime. */
  folder: string;
  /** Max allowed upload size in bytes */
  maxBytes: number;
  /** Allowed MIME types */
  allowedMimes: string[];
  /**
   * true  → one-per-org, key = folder/{assetType}.{ext}  (overwrites old file)
   * false → many-per-entity, key = folder/{uuid}.{ext}   (unique per upload)
   */
  singleton: boolean;
  /**
   * true  → object is publicly readable via CDN URL
   * false → object is private; presigned GET URLs must be generated for reads
   */
  public: boolean;
}

export const ASSET_CONFIG: Record<AssetType, AssetConfig> = {
  ORG_LOGO: {
    folder: 'org/{orgId}',
    maxBytes: 5_000_000,
    allowedMimes: ['image/png', 'image/jpeg', 'image/webp'],
    singleton: true,
    public: true,
  },
  ORG_BIS_LOGO: {
    folder: 'org/{orgId}',
    maxBytes: 2_000_000,
    allowedMimes: ['image/png', 'image/jpeg', 'image/webp'],
    singleton: true,
    public: true,
  },
  ORG_QR_CODE: {
    folder: 'org/{orgId}',
    maxBytes: 2_000_000,
    allowedMimes: ['image/png', 'image/jpeg', 'image/webp'],
    singleton: true,
    public: true,
  },
  ORG_SIGNATURE: {
    folder: 'org/{orgId}',
    maxBytes: 3_000_000,
    allowedMimes: ['image/png', 'image/jpeg', 'image/webp'],
    singleton: true,
    public: true,
  },
  JEWELLERY_PHOTO: {
    folder: 'org/{orgId}/jewellery',
    maxBytes: 10_000_000,
    allowedMimes: ['image/png', 'image/jpeg', 'image/webp'],
    singleton: false,
    public: true,
  },
  BARCODE_LABEL: {
    folder: 'org/{orgId}/barcodes',
    maxBytes: 1_000_000,
    allowedMimes: ['image/png'],
    singleton: false,
    public: true,
  },
  CUSTOMER_DOC: {
    folder: 'org/{orgId}/customers/{entityId}',
    maxBytes: 10_000_000,
    allowedMimes: ['image/png', 'image/jpeg', 'application/pdf'],
    singleton: false,
    public: false, // private — KYC documents are sensitive
  },
};
