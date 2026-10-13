ALTER TABLE `makeup_bookings`
DROP FOREIGN KEY `makeup_bookings_replacementParticipantId_fkey`;

DROP INDEX `makeup_bookings_replacementParticipantId_key` ON `makeup_bookings`;

CREATE INDEX `makeup_bookings_replacementParticipantId_idx`
ON `makeup_bookings`(`replacementParticipantId`);

ALTER TABLE `makeup_bookings`
ADD CONSTRAINT `makeup_bookings_replacementParticipantId_fkey`
FOREIGN KEY (`replacementParticipantId`) REFERENCES `session_participants`(`id`)
ON DELETE RESTRICT ON UPDATE CASCADE;
