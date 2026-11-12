import { inTerm } from './academic-access.service';

interface AssignmentWindow {
  status: string;
  dueAt: Date;
  answersPublishedAt?: Date | null;
  maxAttempts: number;
}
interface RecipientWindow {
  assignedAt?: Date | null;
  dueAtOverride?: Date | null;
  enrollment: { status: string; startDate: Date | null; endDate: Date | null };
}

export interface SubmissionWindow {
  assignedAt: Date | null;
  dueAtOverride: Date | null;
  effectiveDueAt: Date;
  isSupplemental: boolean;
  canSubmit: boolean;
  submissionBlockReason:
    | 'ANSWERS_ALREADY_VISIBLE'
    | 'SUBMISSION_CLOSED'
    | 'DEADLINE_PASSED'
    | 'ENROLLMENT_CLOSED'
    | 'ATTEMPTS_EXHAUSTED'
    | null;
}

/** One rule shared by API responses and submission validation. */
export function submissionWindow(
  assignment: AssignmentWindow,
  recipient: RecipientWindow,
  attempts: number,
  now = new Date(),
): SubmissionWindow {
  const effectiveDueAt = recipient.dueAtOverride ?? assignment.dueAt;
  const isSupplemental = !!recipient.dueAtOverride;
  const submissionBlockReason = assignment.answersPublishedAt
    ? 'ANSWERS_ALREADY_VISIBLE'
    : assignment.status === 'DRAFT' || (!isSupplemental && assignment.status !== 'PUBLISHED')
      ? 'SUBMISSION_CLOSED'
      : effectiveDueAt < now
        ? 'DEADLINE_PASSED'
        : !inTerm(recipient.enrollment, now)
          ? 'ENROLLMENT_CLOSED'
          : attempts >= assignment.maxAttempts
            ? 'ATTEMPTS_EXHAUSTED'
            : null;
  return {
    assignedAt: recipient.assignedAt ?? null,
    dueAtOverride: recipient.dueAtOverride ?? null,
    effectiveDueAt,
    isSupplemental,
    canSubmit: !submissionBlockReason,
    submissionBlockReason,
  };
}
