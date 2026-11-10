-- Teacher review is now the final CLO approval. Preserve valid reviews already completed.
UPDATE `outcome_sets` AS s
SET s.`status` = 'APPROVED', s.`approvedById` = s.`reviewerId`, s.`approvedAt` = s.`reviewedAt`
WHERE s.`status` = 'TECHNICALLY_APPROVED'
  AND s.`reviewerId` IS NOT NULL AND s.`reviewedAt` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `learning_outcomes` o
    LEFT JOIN `lesson_outcomes` l ON l.`outcomeId` = o.`id`
    WHERE o.`outcomeSetId` = s.`id`
    GROUP BY o.`outcomeSetId`
    HAVING SUM(CASE WHEN o.`sourceStatus` = 'VERIFIED'
      AND o.`verifiedById` = s.`reviewerId` AND l.`outcomeId` IS NOT NULL
      THEN 0 ELSE 1 END) = 0
  );

-- Incomplete legacy reviews need teacher verification again, not automatic approval.
UPDATE `outcome_sets`
SET `status` = 'DRAFT', `reviewerId` = NULL, `reviewedAt` = NULL,
    `approvedById` = NULL, `approvedAt` = NULL,
    `reviewNote` = CONCAT_WS('\n', NULLIF(`reviewNote`, ''), 'Cần giáo viên xác minh lại CLO trước khi duyệt theo luồng mới.')
WHERE `status` = 'TECHNICALLY_APPROVED';

ALTER TABLE `outcome_sets` MODIFY `status` ENUM('DRAFT', 'APPROVED') NOT NULL DEFAULT 'DRAFT';
