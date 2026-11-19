-- Assignment-level CLO links (L1). assignment_questions.outcomeId stays for reading old rows.
CREATE TABLE `assignment_outcomes` (
  `assignmentId` VARCHAR(191) NOT NULL,
  `outcomeId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`assignmentId`, `outcomeId`),
  INDEX `assignment_outcomes_outcomeId_idx` (`outcomeId`),
  CONSTRAINT `assignment_outcomes_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `assignments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `assignment_outcomes_outcomeId_fkey` FOREIGN KEY (`outcomeId`) REFERENCES `learning_outcomes` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Copy existing per-question CLO links, one row per (assignment, outcome).
INSERT INTO `assignment_outcomes` (`assignmentId`, `outcomeId`)
SELECT DISTINCT q.`assignmentId`, q.`outcomeId`
FROM `assignment_questions` q
WHERE q.`outcomeId` IS NOT NULL;
