-- Add per-user chat mode with a privacy-safe default.
CREATE TYPE "ChatMode" AS ENUM ('PRIVATE', 'GROUP');

ALTER TABLE "User"
ADD COLUMN "chatMode" "ChatMode" NOT NULL DEFAULT 'PRIVATE';
