-- Add passwordHash column if it does not already exist
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;


