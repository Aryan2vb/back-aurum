-- CreateEnum
CREATE TYPE "MetalType" AS ENUM ('GOLD', 'SILVER');

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "metalType" "MetalType" NOT NULL DEFAULT 'GOLD';
