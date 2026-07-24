/*
  Warnings:

  - Added the required column `createdBy` to the `Customer` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "createdBy" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Customer_organizationId_createdBy_idx" ON "Customer"("organizationId", "createdBy");
