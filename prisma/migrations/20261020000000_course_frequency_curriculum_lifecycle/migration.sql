-- Nullable during client/data transition. Never invent a course frequency for
-- courses without a consistent set of valid active-class weekly timetables.
ALTER TABLE `programs` ADD COLUMN `sessionsPerWeek` INTEGER NULL;

ALTER TABLE `curriculum_units`
  ADD COLUMN `archivedAt` DATETIME(3) NULL,
  ADD COLUMN `archiveReason` VARCHAR(32) NULL,
  ADD COLUMN `supersededById` VARCHAR(191) NULL;

-- Preserve the meaning of pre-existing manual archives.
UPDATE `curriculum_units`
SET `archiveReason` = 'MANUAL'
WHERE `status` = 'ARCHIVED';

-- Infer only when every active class has a nonempty, valid timetable and
-- all such classes have the same count. Empty/invalid/mixed courses stay NULL
-- for explicit configuration. No existing timetable or session is changed.
UPDATE `programs` AS p
JOIN (
  SELECT c.`programId`, MIN(t.`slotCount`) AS `frequency`
  FROM `classes` AS c
  LEFT JOIN (
    SELECT s.`classId`, COUNT(*) AS `slotCount`,
      SUM(CASE WHEN s.`weekday` BETWEEN 1 AND 7
        AND s.`startTime` REGEXP '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND s.`endTime` REGEXP '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND s.`startTime` < s.`endTime` THEN 0 ELSE 1 END) AS `invalidCount`
    FROM `class_weekly_schedules` AS s
    GROUP BY s.`classId`
  ) AS t ON t.`classId` = c.`id`
  WHERE c.`isActive` = TRUE
  GROUP BY c.`programId`
  HAVING COUNT(*) = COUNT(t.`classId`)
    AND MIN(t.`slotCount`) BETWEEN 1 AND 14
    AND MIN(t.`slotCount`) = MAX(t.`slotCount`)
    AND SUM(t.`invalidCount`) = 0
    AND NOT EXISTS (
      SELECT 1 FROM `classes` AS invalid_class
      JOIN `class_weekly_schedules` AS a ON a.`classId` = invalid_class.`id`
      JOIN `class_weekly_schedules` AS b ON b.`classId` = a.`classId`
        AND a.`id` < b.`id` AND a.`weekday` = b.`weekday`
        AND a.`startTime` < b.`endTime` AND a.`endTime` > b.`startTime`
      WHERE invalid_class.`programId` = c.`programId`
        AND invalid_class.`isActive` = TRUE
    )
) AS inferred ON inferred.`programId` = p.`id`
SET p.`sessionsPerWeek` = inferred.`frequency`;
