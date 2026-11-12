import { submissionWindow } from '../../src/modules/academic/submission-window';
import { SupplementalRecipientsDto } from '../../src/modules/academic/academic.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

describe('recipient submission windows', () => {
  const now = new Date('2026-11-15T10:00:00Z');
  const future = new Date('2026-11-17T10:00:00Z');
  const past = new Date('2026-11-12T10:00:00Z');
  const assignment = { status: 'CLOSED', dueAt: past, maxAttempts: 2, answersPublishedAt: null };
  const recipient = {
    dueAtOverride: future,
    enrollment: {
      status: 'ACTIVE',
      startDate: new Date('2026-11-14'),
      endDate: new Date('2026-12-14'),
    },
  };

  it('allows a newcomer to submit closed/expired work until their own deadline', () => {
    expect(submissionWindow(assignment, recipient, 0, now)).toMatchObject({
      effectiveDueAt: future,
      isSupplemental: true,
      canSubmit: true,
      submissionBlockReason: null,
    });
    expect(
      submissionWindow(assignment, { ...recipient, dueAtOverride: null }, 0, now),
    ).toMatchObject({
      effectiveDueAt: past,
      isSupplemental: false,
      canSubmit: false,
    });
  });

  it.each([
    ['draft', { ...assignment, status: 'DRAFT' }, recipient, 0, 'SUBMISSION_CLOSED'],
    [
      'answers visible',
      { ...assignment, answersPublishedAt: past },
      recipient,
      0,
      'ANSWERS_ALREADY_VISIBLE',
    ],
    [
      'own deadline expired',
      assignment,
      { ...recipient, dueAtOverride: past },
      0,
      'DEADLINE_PASSED',
    ],
    [
      'ended enrollment',
      assignment,
      { ...recipient, enrollment: { ...recipient.enrollment, status: 'ENDED' } },
      0,
      'ENROLLMENT_CLOSED',
    ],
    [
      'unlinked enrollment',
      assignment,
      { ...recipient, enrollment: { ...recipient.enrollment, status: 'PENDING_LINK' } },
      0,
      'ENROLLMENT_CLOSED',
    ],
    ['attempts exhausted', assignment, recipient, 2, 'ATTEMPTS_EXHAUSTED'],
  ])('blocks %s', (_label, a, r, attempts, reason) => {
    expect(submissionWindow(a, r, attempts, now)).toMatchObject({
      canSubmit: false,
      submissionBlockReason: reason,
    });
  });

  it('keeps the personal deadline when the general window is reopened', () => {
    expect(
      submissionWindow(
        { ...assignment, status: 'PUBLISHED', dueAt: new Date('2026-12-01') },
        recipient,
        1,
        now,
      ).effectiveDueAt,
    ).toEqual(future);
    expect(submissionWindow(assignment, recipient, 0, future).canSubmit).toBe(true);
    expect(
      submissionWindow(assignment, recipient, 0, new Date(future.getTime() + 1)).canSubmit,
    ).toBe(false);
  });

  it('keeps legacy recipients on the general window', () => {
    const legacy = { enrollment: recipient.enrollment };
    expect(
      submissionWindow({ ...assignment, status: 'PUBLISHED', dueAt: future }, legacy, 0, now),
    ).toMatchObject({
      assignedAt: null,
      dueAtOverride: null,
      isSupplemental: false,
      canSubmit: true,
    });
  });

  it.each([
    { enrollmentIds: [] },
    { enrollmentIds: ['a', 'a'] },
    { enrollmentIds: [''] },
    { enrollmentIds: Array.from({ length: 101 }, (_, i) => `${i}`) },
    { dueAt: '2026-11-17T10:00:00' },
    { dueAt: 'not-a-date' },
  ])('validates supplemental request boundaries %#', async (invalid) => {
    const dto = plainToInstance(SupplementalRecipientsDto, {
      enrollmentIds: ['a'],
      dueAt: future.toISOString(),
      ...invalid,
    });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});
