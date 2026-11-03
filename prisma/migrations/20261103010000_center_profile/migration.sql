-- CreateTable
CREATE TABLE `center_profiles` (
  `id` VARCHAR(32) NOT NULL DEFAULT 'default',
  `name` VARCHAR(255) NULL,
  `address` VARCHAR(500) NULL,
  `phone` VARCHAR(32) NULL,
  `email` VARCHAR(255) NULL,
  `openingHours` VARCHAR(255) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
