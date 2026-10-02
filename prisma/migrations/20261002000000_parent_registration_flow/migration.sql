ALTER TABLE `users` ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL;

ALTER TABLE `registration_orders`
  ADD COLUMN `startDate` DATE NULL,
  ADD COLUMN `endDate` DATE NULL;

ALTER TABLE `registration_orders` MODIFY `status` ENUM('DRAFT', 'COMPLETED', 'PAYMENT_CONFIRMED', 'LINKED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT';
ALTER TABLE `users` MODIFY `role` ENUM('STAFF', 'MANAGER', 'TEACHER', 'CURRICULUM_DESIGNER', 'PARENT') NOT NULL;

CREATE TABLE `email_verification_tokens` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `email_verification_tokens_tokenHash_key` (`tokenHash`),
  INDEX `email_verification_tokens_userId_usedAt_idx` (`userId`, `usedAt`),
  INDEX `email_verification_tokens_expiresAt_idx` (`expiresAt`),
  CONSTRAINT `email_verification_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `class_weekly_schedules` (
  `id` VARCHAR(191) NOT NULL,
  `classId` VARCHAR(191) NOT NULL,
  `weekday` INTEGER NOT NULL,
  `startTime` VARCHAR(5) NOT NULL,
  `endTime` VARCHAR(5) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `class_weekly_schedules_classId_weekday_idx` (`classId`, `weekday`),
  CONSTRAINT `class_weekly_schedules_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `class_weekly_schedules_weekday_check` CHECK (`weekday` BETWEEN 1 AND 7),
  CONSTRAINT `class_weekly_schedules_time_format_check` CHECK (`startTime` REGEXP '^[0-2][0-9]:[0-5][0-9]$' AND `endTime` REGEXP '^[0-2][0-9]:[0-5][0-9]$' AND `startTime` < `endTime`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
