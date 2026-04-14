-- Rename preserves any existing attachment URLs instead of dropping data.
ALTER TABLE "SymptomLog"
RENAME COLUMN "attachmentUrl" TO "photoUrl";

ALTER TABLE "SymptomLog"
ADD COLUMN "voiceNoteUrl" TEXT;
