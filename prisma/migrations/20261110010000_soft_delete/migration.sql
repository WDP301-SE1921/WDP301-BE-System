-- Xóa mềm cho web Admin tổng. Chỉ thêm cột cho phép NULL (NULL = chưa xóa); không đổi dữ liệu cũ.

ALTER TABLE `users` ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `deletedById` VARCHAR(191) NULL,
    ADD COLUMN `deleteReason` VARCHAR(300) NULL;

ALTER TABLE `student_profiles` ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `deletedById` VARCHAR(191) NULL,
    ADD COLUMN `deleteReason` VARCHAR(300) NULL;

ALTER TABLE `subjects` ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `deletedById` VARCHAR(191) NULL,
    ADD COLUMN `deleteReason` VARCHAR(300) NULL;

ALTER TABLE `programs` ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `deletedById` VARCHAR(191) NULL,
    ADD COLUMN `deleteReason` VARCHAR(300) NULL;

ALTER TABLE `classes` ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `deletedById` VARCHAR(191) NULL,
    ADD COLUMN `deleteReason` VARCHAR(300) NULL;

ALTER TABLE `rooms` ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `deletedById` VARCHAR(191) NULL,
    ADD COLUMN `deleteReason` VARCHAR(300) NULL;
