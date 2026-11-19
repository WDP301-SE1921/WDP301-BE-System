import type { NotificationEventsService } from '../../src/modules/notifications/notification-events.service';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import type { DatabaseService } from '../../src/database/orm/database.service';
import { CurriculumSchedulingService } from '../../src/modules/curriculum-scheduling/curriculum-scheduling.service';

const designer = { id: 'designer', role: 'CURRICULUM_DESIGNER' } as AuthenticatedUser;
const teacher = { id: 'teacher', role: 'TEACHER' } as AuthenticatedUser;
const manager = { id: 'manager', role: 'MANAGER' } as AuthenticatedUser;

type Lesson = {
  id: string;
  kind: string;
  title: string;
  content: string;
  sequence: number;
  outcomeLinks: Array<{ outcomeId: string }>;
};

function lesson(sequence: number, linked: boolean): Lesson {
  return {
    id: `lesson-${sequence}`,
    kind: 'LESSON',
    title: `Bài ${sequence}`,
    content: 'Nội dung',
    sequence,
    outcomeLinks: linked ? [{ outcomeId: 'clo' }] : [],
  };
}

function setup(overrides: Record<string, unknown> = {}, outcomeSets = 1) {
  const unit = {
    id: 'unit',
    programId: 'program',
    trackId: 'track',
    designerId: designer.id,
    reviewerTeacherId: teacher.id,
    technicalReviewedAt: null as Date | null,
    approvedAt: null as Date | null,
    basedOnId: null,
    title: 'Toán 8',
    status: 'DRAFT',
    revision: 1,
    fromDate: new Date('2099-01-04T00:00:00Z'),
    toDate: new Date('2099-06-30T00:00:00Z'),
    lessons: [lesson(1, true), lesson(2, false), lesson(3, false)] as Lesson[],
    ...overrides,
  };
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
    outcomeSet: { count: jest.fn().mockResolvedValue(outcomeSets) },
    program: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'program',
        isActive: true,
        deletedAt: null,
        subjectId: null,
        subject: 'Toán',
        grade: 8,
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    curriculumTrack: { upsert: jest.fn().mockResolvedValue({ id: 'track' }) },
    curriculumUnit: {
      findUnique: jest.fn().mockResolvedValue(unit),
      findUniqueOrThrow: jest.fn().mockResolvedValue(unit),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(unit),
      create: jest.fn().mockResolvedValue({ id: 'new-unit' }),
      aggregate: jest.fn().mockResolvedValue({ _max: { version: null } }),
    },
    class: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]) },
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: teacher.id, role: 'TEACHER', status: 'ACTIVE' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    lesson: { updateMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
    lessonOutcome: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  db.$transaction.mockImplementation((action: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
    action(db as unknown as Prisma.TransactionClient),
  );
  const service = new CurriculumSchedulingService(
    db as unknown as DatabaseService,
    { curriculum: jest.fn(), schedule: jest.fn() } as unknown as NotificationEventsService,
  );
  return { service, db, unit };
}

describe('curriculum requires CLOs first (L1)', () => {
  it('blocks createUnit while the program has no outcome set with an outcome', async () => {
    const { service, db } = setup({}, 0);
    await expect(
      service.createUnit(designer, {
        programId: 'program',
        title: 'Toán 8',
        fromDate: '2099-01-04',
        toDate: '2099-06-30',
      }),
    ).rejects.toMatchObject({ code: 'OUTCOMES_REQUIRED', statusCode: 409 });
    expect(db.outcomeSet.count).toHaveBeenCalledWith({
      where: { programId: 'program', status: { in: ['DRAFT', 'APPROVED'] }, outcomes: { some: {} } },
    });
    expect(db.curriculumUnit.create).not.toHaveBeenCalled();
  });

  it('creates the unit once an outcome exists', async () => {
    const { service, db } = setup();
    await service.createUnit(designer, {
      programId: 'program',
      title: 'Toán 8',
      fromDate: '2099-01-04',
      toDate: '2099-06-30',
    });
    expect(db.curriculumUnit.create).toHaveBeenCalled();
  });

  it('blocks reviseUnit without outcomes before copying anything', async () => {
    const { service, db } = setup({ status: 'APPROVED' }, 0);
    await expect(
      service.reviseUnit(designer, 'unit', {
        title: 'Kỳ sau',
        fromDate: '2099-07-01',
        toDate: '2099-12-31',
      }),
    ).rejects.toMatchObject({ code: 'OUTCOMES_REQUIRED' });
    expect(db.curriculumUnit.create).not.toHaveBeenCalled();
  });

  it('validation lists the lessons without a CLO link', async () => {
    const { service } = setup();
    await expect(service.validation(designer, 'unit')).resolves.toMatchObject({
      ready: false,
      errors: [{ code: 'LESSON_OUTCOME_MISSING', lessonIds: ['lesson-2', 'lesson-3'] }],
    });
  });

  it('validation is ready when every lesson is linked', async () => {
    const { service } = setup({ lessons: [lesson(1, true), lesson(2, true)] });
    await expect(service.validation(designer, 'unit')).resolves.toMatchObject({ ready: true });
  });

  it('does not apply the rule to an already approved unit', async () => {
    const { service } = setup({ status: 'APPROVED' });
    await expect(service.validation(designer, 'unit')).resolves.toMatchObject({ ready: true });
  });

  it('ignores monthly tests without links', async () => {
    const { service } = setup({
      lessons: [lesson(1, true), { ...lesson(1, false), id: 'test', kind: 'MONTHLY_TEST' }],
    });
    await expect(service.validation(designer, 'unit')).resolves.toMatchObject({ ready: true });
  });

  it('returning a unit (approved:false) is not blocked by unlinked lessons', async () => {
    const { service, db } = setup({ status: 'PENDING_REVIEW' });
    await service.technicalReview(teacher, 'unit', {
      approved: false,
      note: 'Sửa lại',
      expectedRevision: 1,
    });
    expect(db.curriculumUnit.update).toHaveBeenCalled();
  });

  it('submit is blocked with the missing lesson ids as details', async () => {
    const { service, db } = setup();
    await expect(
      service.submitUnit(designer, 'unit', { reviewerTeacherId: teacher.id }),
    ).rejects.toMatchObject({
      code: 'LESSON_OUTCOME_MISSING',
      details: { lessonIds: ['lesson-2', 'lesson-3'] },
    });
    expect(db.curriculumUnit.update).not.toHaveBeenCalled();
  });

  it('teacher approval and manager approval are blocked too', async () => {
    const pending = setup({ status: 'PENDING_REVIEW' });
    await expect(
      pending.service.technicalReview(teacher, 'unit', { approved: true, expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: 'LESSON_OUTCOME_MISSING' });
    expect(pending.db.curriculumUnit.update).not.toHaveBeenCalled();
    const reviewed = setup({ status: 'PENDING_REVIEW', technicalReviewedAt: new Date() });
    await expect(reviewed.service.approveUnit(manager, 'unit')).rejects.toMatchObject({
      code: 'LESSON_OUTCOME_MISSING',
      details: { lessonIds: ['lesson-2', 'lesson-3'] },
    });
    expect(reviewed.db.lesson.updateMany).not.toHaveBeenCalled();
  });
});
