-- Excel/CSV import of CLOs: a stored preview and an idempotent commit per outcome set.
CREATE TABLE `outcome_import_previews` (
  `id` VARCHAR(191) NOT NULL,
  `outcomeSetId` VARCHAR(191) NOT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `rows` JSON NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `outcome_import_previews_outcomeSetId_expiresAt_idx`(`outcomeSetId`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `outcome_import_previews` ADD CONSTRAINT `outcome_import_previews_outcomeSetId_fkey`
  FOREIGN KEY (`outcomeSetId`) REFERENCES `outcome_sets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `outcome_import_commits` (
  `id` VARCHAR(191) NOT NULL,
  `outcomeSetId` VARCHAR(191) NOT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `response` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `outcome_import_commits_outcomeSetId_key_key`(`outcomeSetId`, `key`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `outcome_import_commits` ADD CONSTRAINT `outcome_import_commits_outcomeSetId_fkey`
  FOREIGN KEY (`outcomeSetId`) REFERENCES `outcome_sets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
