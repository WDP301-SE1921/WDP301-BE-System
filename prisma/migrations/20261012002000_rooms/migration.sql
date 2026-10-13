CREATE TABLE `rooms` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `capacity` INTEGER NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `rooms_name_key`(`name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `classes` ADD COLUMN `roomId` VARCHAR(191) NULL;
ALTER TABLE `class_sessions` ADD COLUMN `roomId` VARCHAR(191) NULL;
CREATE INDEX `classes_roomId_idx` ON `classes`(`roomId`);
CREATE INDEX `class_sessions_roomId_startsAt_idx` ON `class_sessions`(`roomId`, `startsAt`);
ALTER TABLE `classes` ADD CONSTRAINT `classes_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `class_sessions` ADD CONSTRAINT `class_sessions_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
