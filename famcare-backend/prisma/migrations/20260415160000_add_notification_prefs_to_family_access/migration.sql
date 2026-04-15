-- Add per-grantee notification preferences to FamilyAccess.
-- Nullable by design: NULL means all notifications are enabled by default.
ALTER TABLE "FamilyAccess"
ADD COLUMN "notificationPrefs" TEXT;
