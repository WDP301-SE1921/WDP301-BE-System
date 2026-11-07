-- AlterTable
ALTER TABLE `chat_messages`
  ADD COLUMN `attachmentStorageKey` VARCHAR(512) NULL,
  ADD COLUMN `attachmentName` VARCHAR(255) NULL,
  ADD COLUMN `attachmentMimeType` VARCHAR(127) NULL,
  ADD COLUMN `attachmentSize` INTEGER NULL;
