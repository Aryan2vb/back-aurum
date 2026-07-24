/*
  Warnings:

  - You are about to drop the column `aadharLast4` on the `Document` table. All the data in the column will be lost.
  - You are about to drop the column `mfaConfirmedAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `mfaSecret` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `MfaBackupCode` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[organizationId,aadharNumber]` on the table `Document` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[organizationId,panNumber]` on the table `Document` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "MfaBackupCode" DROP CONSTRAINT "MfaBackupCode_userId_fkey";

-- DropIndex
DROP INDEX "Document_organizationId_aadharLast4_key";

-- AlterTable
ALTER TABLE "Document" DROP COLUMN "aadharLast4",
ADD COLUMN     "aadharNumber" CHAR(12),
ADD COLUMN     "panNumber" CHAR(10),
ADD COLUMN     "panVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "mfaConfirmedAt",
DROP COLUMN "mfaSecret";

-- DropTable
DROP TABLE "MfaBackupCode";

-- CreateIndex
CREATE UNIQUE INDEX "Document_organizationId_aadharNumber_key" ON "Document"("organizationId", "aadharNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Document_organizationId_panNumber_key" ON "Document"("organizationId", "panNumber");
