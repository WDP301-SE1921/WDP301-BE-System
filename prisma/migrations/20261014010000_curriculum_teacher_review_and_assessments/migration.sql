-- Preserve existing approved curricula and historical sessions.
ALTER TABLE `curriculum_units`
    ADD COLUMN `reviewerTeacherId` VARCHAR(191) NULL,
    ADD COLUMN `technicalReviewedAt` DATETIME(3) NULL,
    ADD COLUMN `technicalReviewNote` TEXT NULL;

CREATE INDEX `curriculum_units_reviewerTeacherId_status_idx`
    ON `curriculum_units`(`reviewerTeacherId`, `status`);

ALTER TABLE `curriculum_units`
    ADD CONSTRAINT `curriculum_units_reviewerTeacherId_fkey`
    FOREIGN KEY (`reviewerTeacherId`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing assignments remain homework; tests are linked to their selected session.
ALTER TABLE `assignments`
    ADD COLUMN `kind` VARCHAR(16) NOT NULL DEFAULT 'HOMEWORK',
    ADD COLUMN `testType` VARCHAR(32) NULL,
    ADD COLUMN `sessionId` VARCHAR(191) NULL;

CREATE INDEX `assignments_sessionId_idx` ON `assignments`(`sessionId`);

ALTER TABLE `assignments`
    ADD CONSTRAINT `assignments_sessionId_fkey`
    FOREIGN KEY (`sessionId`) REFERENCES `class_sessions`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
