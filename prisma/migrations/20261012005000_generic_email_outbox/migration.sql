ALTER TABLE `outbox_events` DROP FOREIGN KEY `outbox_events_aggregateId_fkey`;
ALTER TABLE `outbox_events`
  ADD COLUMN `aggregateType` VARCHAR(191) NOT NULL DEFAULT 'RegistrationOrder',
  ADD COLUMN `recipient` VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN `subject` VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN `dedupeKey` VARCHAR(191) NULL,
  ADD COLUMN `maxAttempts` INTEGER NOT NULL DEFAULT 5;
UPDATE `outbox_events` SET `dedupeKey` = CONCAT(`eventType`, ':', `aggregateId`, ':', `id`) WHERE `dedupeKey` IS NULL;
ALTER TABLE `outbox_events` MODIFY `dedupeKey` VARCHAR(191) NOT NULL;
CREATE UNIQUE INDEX `outbox_events_dedupeKey_key` ON `outbox_events`(`dedupeKey`);
