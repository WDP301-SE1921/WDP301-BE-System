CREATE TABLE `subjects` (
  `id` VARCHAR(191) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `subjects_code_key`(`code`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `programs`
  ADD COLUMN `subjectId` VARCHAR(191) NULL,
  ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `classes` ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE `class_sessions`
  ADD COLUMN `cancelReason` TEXT NULL,
  ADD COLUMN `cancelledAt` DATETIME(3) NULL,
  ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 1;

INSERT INTO `subjects` (`id`, `code`, `name`, `updatedAt`)
SELECT UUID(), SUBSTRING(SHA2(names.`subjectKey`, 256), 1, 16), names.`name`, CURRENT_TIMESTAMP(3)
FROM (
  SELECT LOWER(TRIM(`subject`)) COLLATE utf8mb4_bin AS `subjectKey`, MIN(TRIM(`subject`)) AS `name`
  FROM `programs`
  GROUP BY LOWER(TRIM(`subject`)) COLLATE utf8mb4_bin
) AS names;

UPDATE `programs` p JOIN `subjects` s
  ON LOWER(TRIM(p.`subject`)) COLLATE utf8mb4_bin = LOWER(s.`name`) COLLATE utf8mb4_bin
SET p.`subjectId` = s.`id`;

CREATE INDEX `programs_subjectId_idx` ON `programs`(`subjectId`);
ALTER TABLE `programs` ADD CONSTRAINT `programs_subjectId_fkey`
  FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `curriculum_units`
  ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `submittedAt` DATETIME(3) NULL,
  ADD COLUMN `reviewedAt` DATETIME(3) NULL,
  ADD COLUMN `reviewedById` VARCHAR(191) NULL,
  ADD COLUMN `reviewNote` TEXT NULL,
  MODIFY COLUMN `status` ENUM('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT';

DROP INDEX `curriculum_units_trackId_fromDate_toDate_version_key` ON `curriculum_units`;
CREATE UNIQUE INDEX `curriculum_units_programId_fromDate_toDate_version_key`
  ON `curriculum_units`(`programId`, `fromDate`, `toDate`, `version`);
CREATE INDEX `curriculum_units_programId_status_idx` ON `curriculum_units`(`programId`, `status`);

CREATE TABLE `curriculum_import_previews` (
  `id` VARCHAR(191) NOT NULL,
  `unitId` VARCHAR(191) NOT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `expectedRevision` INTEGER NOT NULL,
  `mode` VARCHAR(16) NOT NULL,
  `rows` JSON NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `curriculum_import_previews_unitId_expiresAt_idx`(`unitId`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `curriculum_import_previews` ADD CONSTRAINT `curriculum_import_previews_unitId_fkey`
  FOREIGN KEY (`unitId`) REFERENCES `curriculum_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `curriculum_import_commits` (
  `id` VARCHAR(191) NOT NULL,
  `unitId` VARCHAR(191) NOT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `response` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `curriculum_import_commits_unitId_key_key`(`unitId`, `key`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `curriculum_import_commits` ADD CONSTRAINT `curriculum_import_commits_unitId_fkey`
  FOREIGN KEY (`unitId`) REFERENCES `curriculum_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `schedule_previews` (
  `id` VARCHAR(191) NOT NULL,
  `classId` VARCHAR(191) NOT NULL,
  `unitId` VARCHAR(191) NOT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `fromDate` DATE NOT NULL,
  `toDate` DATE NOT NULL,
  `snapshotHash` CHAR(64) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `schedule_previews_classId_expiresAt_idx`(`classId`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `session_mutations` (
  `id` VARCHAR(191) NOT NULL,
  `sessionId` VARCHAR(191) NOT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `response` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `session_mutations_sessionId_key_key`(`sessionId`, `key`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `session_mutations` ADD CONSTRAINT `session_mutations_sessionId_fkey`
  FOREIGN KEY (`sessionId`) REFERENCES `class_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
