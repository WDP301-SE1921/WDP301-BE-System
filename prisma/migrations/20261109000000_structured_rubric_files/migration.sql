ALTER TABLE `assignment_questions` ADD COLUMN `criteria` JSON NULL;
ALTER TABLE `grade_reviews` ADD COLUMN `rubricSnapshot` JSON NULL;
CREATE TABLE `assignment_files` (
  `assignmentId` VARCHAR(191) NOT NULL,
  `fileId` VARCHAR(191) NOT NULL,
  `teacherOnly` BOOLEAN NOT NULL DEFAULT false,
  `questionPosition` INTEGER NULL,
  PRIMARY KEY (`assignmentId`, `fileId`),
  CONSTRAINT `assignment_files_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `assignments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `assignment_files_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `file_assets` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
