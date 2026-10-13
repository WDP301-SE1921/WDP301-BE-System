ALTER TABLE `classes`
  ADD COLUMN `scheduleConfirmedAt` DATETIME(3) NULL,
  ADD COLUMN `scheduleConfirmedById` VARCHAR(191) NULL;
CREATE INDEX `classes_scheduleConfirmedById_idx` ON `classes`(`scheduleConfirmedById`);
ALTER TABLE `classes` ADD CONSTRAINT `classes_scheduleConfirmedById_fkey`
  FOREIGN KEY (`scheduleConfirmedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
