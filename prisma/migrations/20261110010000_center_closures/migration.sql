-- Center-wide days off (B5). New table only; existing rows are untouched.

-- CreateTable
CREATE TABLE `center_closures` (
  `id` VARCHAR(191) NOT NULL,
  `fromDate` DATE NOT NULL,
  `toDate` DATE NOT NULL,
  `reason` VARCHAR(255) NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `revision` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `center_closures_fromDate_toDate_idx`(`fromDate`, `toDate`),
  INDEX `center_closures_createdById_idx`(`createdById`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `center_closures` ADD CONSTRAINT `center_closures_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
