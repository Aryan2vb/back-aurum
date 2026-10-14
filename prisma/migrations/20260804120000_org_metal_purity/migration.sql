-- CreateTable
CREATE TABLE "OrgMetalPurity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "metalType" "MetalType" NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgMetalPurity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgMetalPurity_organizationId_metalType_isActive_idx" ON "OrgMetalPurity"("organizationId", "metalType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "OrgMetalPurity_organizationId_metalType_label_key" ON "OrgMetalPurity"("organizationId", "metalType", "label");

-- AddForeignKey
ALTER TABLE "OrgMetalPurity" ADD CONSTRAINT "OrgMetalPurity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "OrgAccessPolicy" (
    "organizationId" TEXT NOT NULL,
    "accessWindowEnabled" BOOLEAN NOT NULL DEFAULT false,
    "accessWindowStart" TEXT NOT NULL DEFAULT '09:00',
    "accessWindowEnd" TEXT NOT NULL DEFAULT '20:00',
    "moduleAccess" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgAccessPolicy_pkey" PRIMARY KEY ("organizationId")
);

-- AddForeignKey
ALTER TABLE "OrgAccessPolicy" ADD CONSTRAINT "OrgAccessPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
