-- Session metadata was introduced by the curriculum assessment migration.
-- Constrain the public assessment values without recreating columns or relations.
ALTER TABLE `assignments`
  MODIFY COLUMN `kind` ENUM('HOMEWORK', 'TEST') NOT NULL DEFAULT 'HOMEWORK',
  MODIFY COLUMN `testType` ENUM('FIFTEEN_MINUTES', 'ONE_PERIOD', 'MIDTERM', 'FINAL') NULL;
