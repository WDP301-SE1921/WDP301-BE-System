ALTER TABLE `assignment_recipients`
  ADD COLUMN `assignedAt` DATETIME(3) NULL,
  ADD COLUMN `assignedById` VARCHAR(191) NULL,
  ADD COLUMN `dueAtOverride` DATETIME(3) NULL;
