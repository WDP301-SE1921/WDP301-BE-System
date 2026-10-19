ALTER TABLE `assignments`
  ADD COLUMN `kind` ENUM('HOMEWORK', 'TEST') NOT NULL DEFAULT 'HOMEWORK',
  ADD COLUMN `testType` ENUM('FIFTEEN_MINUTES', 'ONE_PERIOD', 'MIDTERM', 'FINAL') NULL,
  ADD COLUMN `sessionId` VARCHAR(191) NULL;
CREATE INDEX `assignments_sessionId_idx` ON `assignments` (`sessionId`);
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_sessionId_fkey`
  FOREIGN KEY (`sessionId`) REFERENCES `class_sessions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
