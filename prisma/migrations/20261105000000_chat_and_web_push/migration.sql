-- AlterTable
ALTER TABLE `notifications`
  MODIFY `targetKind` ENUM(
    'ASSIGNMENT',
    'SUBMISSION',
    'SESSION',
    'CLASS',
    'LEAVE',
    'MAKEUP',
    'ENROLLMENT',
    'REGISTRATION',
    'CURRICULUM_UNIT',
    'FEEDBACK',
    'CHAT_CONVERSATION'
  ) NOT NULL;

-- CreateTable
CREATE TABLE `chat_conversations` (
  `id` VARCHAR(191) NOT NULL,
  `directKey` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `chat_conversations_directKey_key`(`directKey`),
  INDEX `chat_conversations_updatedAt_id_idx`(`updatedAt`, `id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_participants` (
  `conversationId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `lastReadAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `chat_participants_userId_conversationId_idx`(`userId`, `conversationId`),
  PRIMARY KEY (`conversationId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_messages` (
  `id` VARCHAR(191) NOT NULL,
  `conversationId` VARCHAR(191) NOT NULL,
  `senderId` VARCHAR(191) NOT NULL,
  `body` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `chat_messages_conversationId_createdAt_id_idx`(`conversationId`, `createdAt`, `id`),
  INDEX `chat_messages_senderId_createdAt_idx`(`senderId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_subscriptions` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `endpointHash` CHAR(64) NOT NULL,
  `endpoint` TEXT NOT NULL,
  `p256dh` TEXT NOT NULL,
  `auth` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `push_subscriptions_endpointHash_key`(`endpointHash`),
  INDEX `push_subscriptions_userId_idx`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `chat_participants`
  ADD CONSTRAINT `chat_participants_conversationId_fkey`
  FOREIGN KEY (`conversationId`) REFERENCES `chat_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_participants`
  ADD CONSTRAINT `chat_participants_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages`
  ADD CONSTRAINT `chat_messages_conversationId_fkey`
  FOREIGN KEY (`conversationId`) REFERENCES `chat_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages`
  ADD CONSTRAINT `chat_messages_senderId_fkey`
  FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `push_subscriptions`
  ADD CONSTRAINT `push_subscriptions_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
