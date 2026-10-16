# Asset Uploads — Current State, Gaps, and Target Design

Question: we will upload more than settings images (invoices, jewellery/inventory photos, employee photos, multiple logos). Is the upload system designed for that?

**Answer: partly.** The base is right, but it is not ready for many asset types yet.

Related: `OOP_SOLID_PATTERNS_PLAN.md` (same folder) and `aurum/docs/OOP_SOLID_PATTERNS_PLAN.md`.
Code references reflect `feat/invoice-footer-snapshots` on 2026-10-16.

## How uploads work today

| Asset | Flow | Where |
|---|---|---|
| Logo, BIS logo, QR, signature, WhatsApp QR | `POST /uploads/presign` → browser `PUT` to R2 → URL saved on an `OrgInvoiceSettings` field (e.g. `logoUrl`) | `src/uploads/upload.service.ts` `presign()`, `asset-type.enum.ts` |
| Invoice footers | `POST /invoice-footers/assets/presign` (creates a `PENDING` DB row) → `PUT` to R2 → `POST /assets/:id/complete` | `upload.service.ts` `presignInvoiceFooterAsset()`, `src/invoices/footer-library.service.ts` |

The two flows share no code. Footers repeat MIME validation and key building in their own method.

## What is good

- **Config-driven Factory (OCP):** `ASSET_CONFIG` defines folder, `maxBytes`, allowed MIME types, `singleton`, and `public` per type. `JEWELLERY_PHOTO`, `BARCODE_LABEL`, and `CUSTOMER_DOC` are already declared.
- **Direct browser-to-R2 uploads:** files never pass through the API server, which scales to many photos.
- **Tenant safety:** keys are namespaced `org/{orgId}/...`, and deletes check the org prefix.
- **Footer lifecycle:** presign → upload → complete, with immutable objects and archive instead of delete. This is the right shape for any asset that needs a DB record.

## What we are lacking

1. **`maxBytes` is not enforced on the server.** `presign()` validates only the MIME type. The signed PUT carries no size constraint, so a client can upload more than the configured limit. The only size check is client-side (5MB for footers in `SettingsPage.js`).
2. **Private assets cannot be read.** `public: false` exists (`CUSTOMER_DOC`), but `UploadService` has no presigned GET method, so private files (KYC, invoices) can't be served safely.
3. **No generic asset record.** Generic uploads store only a URL string on a field. Multiple logos, product galleries, employee photos, and invoice attachments need a DB row (owner entity, type, key, size, status) to list, order, archive, and clean up orphans.
4. **Footers forked the system (OCP/DRY violation).** Because there is no generic record or lifecycle, footers got their own presign/complete/delete path. Every new DB-backed type would copy it again. Separate rules per path already caused a bug: a footer-only `Cache-Control` header broke the R2 CORS preflight (403).
5. **Footer rules live in the generic upload controller (SRP/DIP).** `upload.controller.ts` (`deleteObject`, ~lines 102-117) queries `prisma.invoiceFooterAsset` directly to block footer deletes. That belongs in the footer domain.
6. **No orphan cleanup.** A presign that is never completed leaves a `PENDING` row (footers) or an unreferenced R2 object (generic). Nothing sweeps them.
7. **Frontend is single-file and settings-coupled.** `uploadService.js` builds its own `fetch` + reads `localStorage` directly (plan items #2/#3), with no multi-file upload, progress, retry, or shared validation from config.
8. **R2 CORS allows only `content-type`.** Any new upload header (cache-control, metadata, checksum) needs the bucket CORS rule updated first.

## Target design

One upload pipeline, driven by config, used by every feature.

```text
ASSET_CONFIG[type]  ──►  AssetService.presign(type, owner)   → creates Asset(PENDING), returns signed PUT
                         browser PUT → R2
                         AssetService.complete(assetId)      → HEAD object, verify size/MIME, Asset(ACTIVE), run onComplete hook
                         AssetService.getReadUrl(assetId)    → CDN URL (public) or presigned GET (private)
                         AssetService.archive(assetId)       → status ARCHIVED (+ per-type delete policy)
```

- **`Asset` table:** `id, organizationId, type, ownerType, ownerId, r2Key, contentType, byteSize, status, displayOrder, createdAt, archivedAt`. Owners: org, invoice, inventory item, employee, customer.
- **Extend `AssetConfig`** with `keyTemplate`, `maxPerOwner`, `deletePolicy` (`delete` | `archive-only`), and `cacheControl`, so behavior differences are data, not new methods (OCP).
- **Per-type hooks (Strategy):** e.g. footers set the default footer on complete; KYC docs are private-only. Domain services subscribe to the hook instead of forking the pipeline.
- **Enforce config on the server:** verify `ContentLength` and MIME via `HeadObject` in `complete()` and delete objects that violate it. Alternatively use a presigned POST with a `content-length-range` condition.
- **Footer library becomes a client** of `AssetService` (`type = INVOICE_FOOTER`) and keeps only folders, tags, and default selection.
- **Cleanup job:** delete `PENDING` assets older than 24h and their R2 objects.
- **Frontend:** one `useAssetUpload(type, owner)` hook (presign → PUT → complete, multi-file, progress, client-side checks from config) on top of the shared `apiClient`.

## Suggested order

1. Enforce `maxBytes`/MIME in a `complete()` step (security; small).
2. Add the `Asset` table + `AssetService` (presign/complete/archive) behind the existing `/uploads` routes.
3. Add `getReadUrl()` with presigned GET for private types.
4. Move footers onto `AssetService`; move the footer delete guard out of `upload.controller.ts`.
5. Frontend `useAssetUpload` hook; then use it for jewellery/inventory photos and employee photos.
6. PENDING cleanup job; CDN cache rule for immutable asset paths.
