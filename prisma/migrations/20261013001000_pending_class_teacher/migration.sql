ALTER TABLE `classes`
  ADD COLUMN `pendingTeacherId` VARCHAR(191) NULL,
  ADD COLUMN `pendingTeacherFrom` DATETIME(3) NULL;

CREATE INDEX `classes_pendingTeacherFrom_idx` ON `classes`(`pendingTeacherFrom`);
