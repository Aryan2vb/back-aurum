-- Add mandatory authenticator MFA support.
ALTER TABLE "User"
  ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfaSecret" TEXT,
  ADD COLUMN "mfaConfirmedAt" TIMESTAMP(3);

CREATE TABLE "MfaBackupCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MfaBackupCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MfaBackupCode_userId_idx" ON "MfaBackupCode"("userId");
CREATE INDEX "MfaBackupCode_userId_consumedAt_idx" ON "MfaBackupCode"("userId", "consumedAt");

ALTER TABLE "MfaBackupCode"
  ADD CONSTRAINT "MfaBackupCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
