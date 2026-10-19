CREATE TABLE `notifications` (
  `id` VARCHAR(191) NOT NULL,
  `recipientUserId` VARCHAR(191) NOT NULL,
  `type` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT NOT NULL,
  `targetKind` ENUM('ASSIGNMENT','SUBMISSION','SESSION','CLASS','LEAVE','MAKEUP','ENROLLMENT','REGISTRATION','CURRICULUM_UNIT','FEEDBACK') NOT NULL,
  `targetId` VARCHAR(191) NOT NULL,
  `classId` VARCHAR(191) NULL,
  `studentIds` JSON NOT NULL,
  `dedupeKey` CHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `readAt` DATETIME(3) NULL,
  UNIQUE INDEX `notifications_dedupeKey_key` (`dedupeKey`),
  INDEX `notifications_recipientUserId_createdAt_id_idx` (`recipientUserId`, `createdAt`, `id`),
  INDEX `notifications_recipientUserId_readAt_idx` (`recipientUserId`, `readAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `notification_dispatches` (
  `id` VARCHAR(191) NOT NULL,
  `recipientUserId` VARCHAR(191) NOT NULL,
  `event` VARCHAR(64) NOT NULL,
  `payload` JSON NOT NULL,
  `status` ENUM('PENDING','PROCESSING','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
  `attemptCount` INTEGER NOT NULL DEFAULT 0,
  `maxAttempts` INTEGER NOT NULL DEFAULT 5,
  `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `leaseToken` VARCHAR(64) NULL,
  `leaseExpiresAt` DATETIME(3) NULL,
  `lastError` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `sentAt` DATETIME(3) NULL,
  INDEX `notification_dispatches_status_nextAttemptAt_idx` (`status`, `nextAttemptAt`),
  INDEX `notification_dispatches_status_leaseExpiresAt_idx` (`status`, `leaseExpiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_recipientUserId_fkey` FOREIGN KEY (`recipientUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `notification_dispatches` ADD CONSTRAINT `notification_dispatches_recipientUserId_fkey` FOREIGN KEY (`recipientUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
