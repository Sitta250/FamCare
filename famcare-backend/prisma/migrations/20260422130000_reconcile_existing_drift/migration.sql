-- Reconcile schema drift already present in database.
-- These statements are idempotent and safe if the drift was already manually applied.

ALTER TYPE "ReminderType" ADD VALUE IF NOT EXISTS 'CUSTOM';

ALTER TABLE "Appointment"
ADD COLUMN IF NOT EXISTS "reminderOffsetsJson" JSONB;

ALTER TABLE "FamilyMember"
ADD COLUMN IF NOT EXISTS "isDeleted" BOOLEAN NOT NULL DEFAULT false;
