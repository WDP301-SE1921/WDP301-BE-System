-- AlterTable
ALTER TABLE `lessons` ADD COLUMN `kind` ENUM('LESSON', 'MONTHLY_TEST') NOT NULL DEFAULT 'LESSON',
    ADD COLUMN `monthKey` VARCHAR(7) NULL,
    ADD COLUMN `unitId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `class_sessions` ADD COLUMN `generationId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `curriculum_tracks` (
    `id` VARCHAR(191) NOT NULL,
    `grade` INTEGER NOT NULL,
    `subjectKey` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `curriculum_tracks_grade_subjectKey_key`(`grade`, `subjectKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `curriculum_units` (
    `id` VARCHAR(191) NOT NULL,
    `trackId` VARCHAR(191) NOT NULL,
    `programId` VARCHAR(191) NOT NULL,
    `designerId` VARCHAR(191) NOT NULL,
    `basedOnId` VARCHAR(191) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `title` VARCHAR(255) NOT NULL,
    `fromDate` DATE NOT NULL,
    `toDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'APPROVED') NOT NULL DEFAULT 'DRAFT',
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `curriculum_units_trackId_status_idx`(`trackId`, `status`),
    UNIQUE INDEX `curriculum_units_trackId_fromDate_toDate_version_key`(`trackId`, `fromDate`, `toDate`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `schedule_generations` (
    `id` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `unitId` VARCHAR(191) NOT NULL,
    `actorUserId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `requestHash` CHAR(64) NOT NULL,
    `fromDate` DATE NOT NULL,
    `toDate` DATE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `schedule_generations_unitId_idx`(`unitId`),
    UNIQUE INDEX `schedule_generations_classId_key_key`(`classId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `lessons_unitId_kind_sequence_key` ON `lessons`(`unitId`, `kind`, `sequence`);

-- CreateIndex
CREATE UNIQUE INDEX `lessons_unitId_kind_monthKey_key` ON `lessons`(`unitId`, `kind`, `monthKey`);

-- CreateIndex
CREATE INDEX `class_sessions_generationId_idx` ON `class_sessions`(`generationId`);

-- AddForeignKey
ALTER TABLE `curriculum_units` ADD CONSTRAINT `curriculum_units_trackId_fkey` FOREIGN KEY (`trackId`) REFERENCES `curriculum_tracks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curriculum_units` ADD CONSTRAINT `curriculum_units_programId_fkey` FOREIGN KEY (`programId`) REFERENCES `programs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curriculum_units` ADD CONSTRAINT `curriculum_units_designerId_fkey` FOREIGN KEY (`designerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `curriculum_units` ADD CONSTRAINT `curriculum_units_basedOnId_fkey` FOREIGN KEY (`basedOnId`) REFERENCES `curriculum_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lessons` ADD CONSTRAINT `lessons_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `curriculum_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `class_sessions` ADD CONSTRAINT `class_sessions_generationId_fkey` FOREIGN KEY (`generationId`) REFERENCES `schedule_generations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_generations` ADD CONSTRAINT `schedule_generations_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_generations` ADD CONSTRAINT `schedule_generations_unitId_fkey` FOREIGN KEY (`unitId`) REFERENCES `curriculum_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_generations` ADD CONSTRAINT `schedule_generations_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
