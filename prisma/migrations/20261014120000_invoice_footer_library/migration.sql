CREATE TYPE "InvoiceFooterAssetStatus" AS ENUM ('PENDING', 'ACTIVE', 'ARCHIVED');

CREATE TABLE "InvoiceFooterFolder" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvoiceFooterFolder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceFooterAsset" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "folderId" TEXT,
  "name" TEXT NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "r2Key" TEXT NOT NULL,
  "publicUrl" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "byteSize" INTEGER,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "status" "InvoiceFooterAssetStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "InvoiceFooterAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceDocumentRevision" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "footerAssetId" TEXT,
  "snapshot" JSONB NOT NULL,
  "pdfR2Key" TEXT NOT NULL,
  "pdfUrl" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceDocumentRevision_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Invoice" ADD COLUMN "footerAssetId" TEXT;
CREATE UNIQUE INDEX "InvoiceFooterFolder_organizationId_name_key" ON "InvoiceFooterFolder"("organizationId", "name");
CREATE UNIQUE INDEX "InvoiceFooterAsset_r2Key_key" ON "InvoiceFooterAsset"("r2Key");
CREATE UNIQUE INDEX "InvoiceDocumentRevision_pdfR2Key_key" ON "InvoiceDocumentRevision"("pdfR2Key");
CREATE UNIQUE INDEX "InvoiceDocumentRevision_invoiceId_revision_key" ON "InvoiceDocumentRevision"("invoiceId", "revision");
CREATE INDEX "InvoiceFooterFolder_organizationId_displayOrder_idx" ON "InvoiceFooterFolder"("organizationId", "displayOrder");
CREATE INDEX "InvoiceFooterAsset_organizationId_status_isDefault_idx" ON "InvoiceFooterAsset"("organizationId", "status", "isDefault");
CREATE INDEX "InvoiceFooterAsset_organizationId_folderId_idx" ON "InvoiceFooterAsset"("organizationId", "folderId");
CREATE INDEX "InvoiceDocumentRevision_organizationId_invoiceId_idx" ON "InvoiceDocumentRevision"("organizationId", "invoiceId");
CREATE INDEX "Invoice_footerAssetId_idx" ON "Invoice"("footerAssetId");
ALTER TABLE "InvoiceFooterFolder" ADD CONSTRAINT "InvoiceFooterFolder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceFooterAsset" ADD CONSTRAINT "InvoiceFooterAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceFooterAsset" ADD CONSTRAINT "InvoiceFooterAsset_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "InvoiceFooterFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_footerAssetId_fkey" FOREIGN KEY ("footerAssetId") REFERENCES "InvoiceFooterAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceDocumentRevision" ADD CONSTRAINT "InvoiceDocumentRevision_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceDocumentRevision" ADD CONSTRAINT "InvoiceDocumentRevision_footerAssetId_fkey" FOREIGN KEY ("footerAssetId") REFERENCES "InvoiceFooterAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
