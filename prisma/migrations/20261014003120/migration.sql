-- AlterTable
ALTER TABLE `outbox_events` ALTER COLUMN `aggregateType` DROP DEFAULT,
    ALTER COLUMN `recipient` DROP DEFAULT,
    ALTER COLUMN `subject` DROP DEFAULT;
