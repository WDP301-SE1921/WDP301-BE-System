ALTER TABLE `users` ADD COLUMN `permissions` JSON NULL;
CREATE TABLE `account_invitations` (
  `id` VARCHAR(191) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `role` ENUM('STAFF','MANAGER','TEACHER','CURRICULUM_DESIGNER','PARENT') NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `status` ENUM('INVITED','ACCEPTED','APPROVED','REJECTED','REVOKED') NOT NULL DEFAULT 'INVITED',
  `invitedById` VARCHAR(191) NOT NULL,
  `acceptedUserId` VARCHAR(191) NULL,
  `reviewedById` VARCHAR(191) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `acceptedAt` DATETIME(3) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `reviewNote` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `account_invitations_tokenHash_key`(`tokenHash`),
  INDEX `account_invitations_email_role_status_idx`(`email`, `role`, `status`),
  INDEX `account_invitations_invitedById_idx`(`invitedById`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `account_invitations` ADD CONSTRAINT `account_invitations_invitedById_fkey` FOREIGN KEY (`invitedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `account_invitations` ADD CONSTRAINT `account_invitations_acceptedUserId_fkey` FOREIGN KEY (`acceptedUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `account_invitations` ADD CONSTRAINT `account_invitations_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
