ALTER TABLE `outbox_events`
  ADD COLUMN `leaseToken` VARCHAR(64) NULL,
  ADD COLUMN `leaseExpiresAt` DATETIME(3) NULL;

CREATE INDEX `outbox_events_status_leaseExpiresAt_idx`
  ON `outbox_events`(`status`, `leaseExpiresAt`);
