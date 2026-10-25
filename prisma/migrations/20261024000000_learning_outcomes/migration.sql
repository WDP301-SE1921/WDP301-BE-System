CREATE TABLE `outcome_sets` (
  `id` VARCHAR(191) NOT NULL,
  `programId` VARCHAR(191) NOT NULL,
  `level` VARCHAR(100) NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `status` ENUM('DRAFT','TECHNICALLY_APPROVED','APPROVED') NOT NULL DEFAULT 'DRAFT',
  `designerId` VARCHAR(191) NOT NULL,
  `reviewerId` VARCHAR(191) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `approvedById` VARCHAR(191) NULL,
  `approvedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `outcome_sets_programId_level_version_key` (`programId`, `level`, `version`),
  INDEX `outcome_sets_programId_status_idx` (`programId`, `status`),
  CONSTRAINT `outcome_sets_programId_fkey` FOREIGN KEY (`programId`) REFERENCES `programs` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `learning_outcomes` (
  `id` VARCHAR(191) NOT NULL,
  `outcomeSetId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `statement` TEXT NOT NULL,
  `sourceTitle` VARCHAR(255) NOT NULL,
  `sourceUrl` TEXT NOT NULL,
  `sourceLocator` VARCHAR(255) NOT NULL,
  `sourceStatus` ENUM('CANDIDATE','VERIFIED') NOT NULL DEFAULT 'CANDIDATE',
  `sourceNote` TEXT NULL,
  `verifiedById` VARCHAR(191) NULL,
  `verifiedAt` DATETIME(3) NULL,
  `required` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `learning_outcomes_outcomeSetId_code_key` (`outcomeSetId`, `code`),
  CONSTRAINT `learning_outcomes_outcomeSetId_fkey` FOREIGN KEY (`outcomeSetId`) REFERENCES `outcome_sets` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lesson_outcomes` (
  `lessonId` VARCHAR(191) NOT NULL,
  `outcomeId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`lessonId`, `outcomeId`),
  CONSTRAINT `lesson_outcomes_lessonId_fkey` FOREIGN KEY (`lessonId`) REFERENCES `lessons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lesson_outcomes_outcomeId_fkey` FOREIGN KEY (`outcomeId`) REFERENCES `learning_outcomes` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `assignments` ADD COLUMN `outcomeSetId` VARCHAR(191) NULL;
ALTER TABLE `assignment_questions` ADD COLUMN `outcomeId` VARCHAR(191) NULL;
CREATE INDEX `assignments_outcomeSetId_idx` ON `assignments`(`outcomeSetId`);
CREATE INDEX `assignment_questions_outcomeId_idx` ON `assignment_questions`(`outcomeId`);
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_outcomeSetId_fkey` FOREIGN KEY (`outcomeSetId`) REFERENCES `outcome_sets` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `assignment_questions` ADD CONSTRAINT `assignment_questions_outcomeId_fkey` FOREIGN KEY (`outcomeId`) REFERENCES `learning_outcomes` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
