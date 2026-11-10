-- Bulk session cancellation (B6, C5): one idempotency record per manager request.
-- New table only; existing rows are untouched.

-- CreateTable
CREATE TABLE `session_bulk_cancels` (
  `id` VARCHAR(191) NOT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `response` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `session_bulk_cancels_actorUserId_key_key`(`actorUserId`, `key`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `session_bulk_cancels` ADD CONSTRAINT `session_bulk_cancels_actorUserId_fkey`
  FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
