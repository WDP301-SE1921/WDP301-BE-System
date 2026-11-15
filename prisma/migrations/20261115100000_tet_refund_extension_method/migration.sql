-- AlterTable
ALTER TABLE `payments` ADD COLUMN `method` ENUM('CASH', 'BANK_TRANSFER') NULL;

-- AlterTable
ALTER TABLE `registration_orders` ADD COLUMN `listAmount` DECIMAL(14, 2) NULL,
    ADD COLUMN `tetDiscountAmount` DECIMAL(14, 2) NULL,
    ADD COLUMN `tetPeriodEnd` DATE NULL,
    ADD COLUMN `tetPeriodStart` DATE NULL;

-- CreateTable
CREATE TABLE `payment_refunds` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `enrollmentId` VARCHAR(191) NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `method` ENUM('CASH', 'BANK_TRANSFER') NOT NULL,
    `reason` VARCHAR(300) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `requestedById` VARCHAR(191) NOT NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payment_refunds_paymentId_status_idx`(`paymentId`, `status`),
    INDEX `payment_refunds_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `payment_refunds_requestedById_decidedAt_idx`(`requestedById`, `decidedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enrollment_extensions` (
    `id` VARCHAR(191) NOT NULL,
    `enrollmentId` VARCHAR(191) NOT NULL,
    `source` ENUM('MANUAL', 'LEAVE', 'SESSION_CANCELLED') NOT NULL,
    `days` INTEGER NOT NULL,
    `reason` VARCHAR(300) NOT NULL,
    `leaveRequestId` VARCHAR(191) NULL,
    `sessionId` VARCHAR(191) NULL,
    `previousEndDate` DATE NOT NULL,
    `newEndDate` DATE NOT NULL,
    `actorUserId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `enrollment_extensions_enrollmentId_createdAt_idx`(`enrollmentId`, `createdAt`),
    UNIQUE INDEX `enrollment_extensions_leaveRequestId_key`(`leaveRequestId`),
    UNIQUE INDEX `enrollment_extensions_sessionId_enrollmentId_key`(`sessionId`, `enrollmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payment_refunds` ADD CONSTRAINT `payment_refunds_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollment_extensions` ADD CONSTRAINT `enrollment_extensions_enrollmentId_fkey` FOREIGN KEY (`enrollmentId`) REFERENCES `enrollments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
