-- AlterTable
ALTER TABLE `email_verification_tokens` ADD COLUMN `failedAttempts` INTEGER NOT NULL DEFAULT 0;
