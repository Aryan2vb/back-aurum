-- Add founder name capture support during signup
ALTER TABLE "User"
ADD COLUMN "fullName" TEXT;
