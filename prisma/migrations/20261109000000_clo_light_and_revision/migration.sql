-- Light CLOs (B3): the three source columns become optional. Only relaxes NOT NULL; existing rows are untouched.
ALTER TABLE `learning_outcomes`
  MODIFY COLUMN `sourceTitle` VARCHAR(255) NULL,
  MODIFY COLUMN `sourceUrl` TEXT NULL,
  MODIFY COLUMN `sourceLocator` VARCHAR(255) NULL;

-- Optimistic concurrency for CLOs edited by several curriculum designers (B2, Q6).
ALTER TABLE `learning_outcomes`
  ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 1;
