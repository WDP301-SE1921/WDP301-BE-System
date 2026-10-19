import type { NotificationEventsService } from '../../src/modules/notifications/notification-events.service';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import type { DatabaseService } from '../../src/database/orm/database.service';
import { CurriculumSchedulingService } from '../../src/modules/curriculum-scheduling/curriculum-scheduling.service';

const designer = { id: 'designer', role: 'CURRICULUM_DESIGNER' } as AuthenticatedUser;
const teacher = { id: 'teacher', role: 'TEACHER' } as AuthenticatedUser;
const manager = { id: 'manager', role: 'MANAGER' } as AuthenticatedUser;

interface ReviewFixture {
  unit: {
    technicalReviewedAt: Date | null;
    lessons: Array<{ id: string; kind: string; title: string; content: string; sequence: number }>;
  };
  db: {
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
    curriculumUnit: Record<
      'findUnique' | 'findUniqueOrThrow' | 'findMany' | 'update' | 'aggregate' | 'create',
      jest.Mock
    >;
    class: Record<'count' | 'findMany', jest.Mock>;
    user: Record<'findFirst' | 'findMany', jest.Mock>;
    lesson: Record<'updateMany' | 'createMany', jest.Mock>;
    auditLog: { create: jest.Mock };
    curriculumImportPreview: { create: jest.Mock };
  };
  service: CurriculumSchedulingService;
}

function containing(value: Record<string, unknown>): unknown {
  return expect.objectContaining(value) as unknown;
}

function setup(overrides: Record<string, unknown> = {}): ReviewFixture {
  const unit = {
    id: 'unit',
    programId: 'program',
    trackId: 'track',
    designerId: designer.id,
    reviewerTeacherId: teacher.id,
    technicalReviewedAt: null as Date | null,
    technicalReviewNote: null,
    basedOnId: null,
    title: 'Toán 8',
    status: 'PENDING_REVIEW',
    revision: 5,
    fromDate: new Date('2026-10-01T00:00:00Z'),
    toDate: new Date('2026-10-31T00:00:00Z'),
    lessons: [{ id: 'lesson', kind: 'LESSON', title: 'Bài 1', content: 'Nội dung', sequence: 1 }],
    ...overrides,
  };
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
    curriculumUnit: {
      findUnique: jest.fn().mockResolvedValue(unit),
      findUniqueOrThrow: jest.fn().mockResolvedValue(unit),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(unit),
      aggregate: jest.fn().mockResolvedValue({ _max: { version: null } }),
      create: jest.fn().mockResolvedValue({ id: 'future-unit' }),
    },
    class: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]) },
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: teacher.id, role: 'TEACHER', status: 'ACTIVE' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    lesson: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), createMany: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    curriculumImportPreview: { create: jest.fn().mockResolvedValue({ id: 'preview' }) },
  };
  db.$transaction.mockImplementation((action: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
    action(db as unknown as Prisma.TransactionClient),
  );
  return {
    unit,
    db,
    service: new CurriculumSchedulingService(
      db as unknown as DatabaseService,
      { curriculum: jest.fn(), schedule: jest.fn() } as unknown as NotificationEventsService,
    ),
  };
}

describe('curriculum teacher review and manager confirmation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('blocks manager confirmation until the selected teacher approves', async () => {
    const { service, db } = setup();
    await expect(service.approveUnit(manager, 'unit')).rejects.toMatchObject({
      code: 'TECHNICAL_REVIEW_REQUIRED',
    });
    expect(db.lesson.updateMany).not.toHaveBeenCalled();
    expect(db.curriculumUnit.update).not.toHaveBeenCalled();
  });

  it('rejects an unrelated teacher and a stale review before any write', async () => {
    const { service, db } = setup();
    await expect(
      service.technicalReview({ ...teacher, id: 'other' }, 'unit', {
        approved: true,
        expectedRevision: 5,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.technicalReview(teacher, 'unit', { approved: true, expectedRevision: 4 }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(db.curriculumUnit.update).not.toHaveBeenCalled();
  });

  it.each(['inactive teacher', 'teacher no longer assigned'])(
    'blocks %s from reviewing',
    async (reason) => {
      const { service, db } = setup();
      if (reason === 'inactive teacher') db.user.findFirst.mockResolvedValue(null);
      else db.class.count.mockResolvedValue(0);
      await expect(
        service.technicalReview(teacher, 'unit', { approved: true, expectedRevision: 5 }),
      ).rejects.toMatchObject({ code: 'INVALID_CURRICULUM_REVIEWER' });
      expect(db.curriculumUnit.update).not.toHaveBeenCalled();
    },
  );

  it('requires a reason when returning a draft and preserves teacher feedback', async () => {
    const { service, db } = setup();
    await expect(
      service.technicalReview(teacher, 'unit', {
        approved: false,
        note: '  ',
        expectedRevision: 5,
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_NOTE_REQUIRED' });
    await service.technicalReview(teacher, 'unit', {
      approved: false,
      note: ' Bổ sung ví dụ ',
      expectedRevision: 5,
    });
    expect(db.curriculumUnit.update).toHaveBeenCalledWith(
      containing({
        data: containing({
          status: 'DRAFT',
          technicalReviewedAt: null,
          technicalReviewNote: 'Bổ sung ví dụ',
          revision: { increment: 1 },
        }),
      }),
    );
  });

  it('teacher approval waits for manager confirmation and cannot be repeated', async () => {
    const { service, db, unit } = setup();
    await service.technicalReview(teacher, 'unit', { approved: true, expectedRevision: 5 });
    expect(db.curriculumUnit.update).toHaveBeenCalledWith(
      containing({
        data: containing({
          status: 'PENDING_REVIEW',
          technicalReviewedAt: expect.any(Date) as unknown,
        }),
      }),
    );
    unit.technicalReviewedAt = new Date();
    await expect(
      service.technicalReview(teacher, 'unit', { approved: true, expectedRevision: 5 }),
    ).rejects.toMatchObject({ code: 'UNIT_NOT_PENDING_TECHNICAL_REVIEW' });
    await service.approveUnit(manager, 'unit');
    expect(db.curriculumUnit.update).toHaveBeenLastCalledWith(
      containing({ data: containing({ status: 'APPROVED' }) }),
    );
    expect(db.lesson.updateMany).toHaveBeenCalledWith({
      where: { unitId: 'unit', kind: 'LESSON' },
      data: { status: 'APPROVED' },
    });
  });

  it('manager return invalidates the earlier teacher approval', async () => {
    const { service, db } = setup({ technicalReviewedAt: new Date() });
    await service.requestChanges(manager, 'unit', 'Thay đổi thời gian áp dụng');
    expect(db.curriculumUnit.update).toHaveBeenCalledWith(
      containing({
        data: containing({ status: 'DRAFT', technicalReviewedAt: null }),
      }),
    );
  });

  it('resubmission validates the responsible teacher and clears stale approval metadata', async () => {
    const { service, db } = setup({ status: 'DRAFT', technicalReviewedAt: new Date() });
    db.class.count.mockResolvedValueOnce(0);
    await expect(
      service.submitUnit(designer, 'unit', { reviewerTeacherId: teacher.id }),
    ).rejects.toMatchObject({ code: 'INVALID_CURRICULUM_REVIEWER' });
    expect(db.curriculumUnit.update).not.toHaveBeenCalled();
    await service.submitUnit(designer, 'unit', { reviewerTeacherId: teacher.id });
    expect(db.curriculumUnit.update).toHaveBeenCalledWith(
      containing({
        data: containing({
          status: 'PENDING_REVIEW',
          reviewerTeacherId: teacher.id,
          technicalReviewedAt: null,
          technicalReviewNote: null,
          reviewedAt: null,
          reviewedById: null,
        }),
      }),
    );
  });

  it('exposes only selected pending reviews in a teacher queue', async () => {
    const { service, db } = setup();
    await service.listUnits(teacher, { status: 'PENDING_REVIEW' });
    expect(db.curriculumUnit.findMany).toHaveBeenCalledWith(
      containing({
        where: containing({
          status: 'PENDING_REVIEW',
          OR: expect.arrayContaining([
            { status: 'PENDING_REVIEW', reviewerTeacherId: teacher.id },
          ]) as unknown,
        }),
      }),
    );
    await expect(service.unit({ ...teacher, id: 'other' }, 'unit')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('lists current teacher candidates without exposing account secrets', async () => {
    const { service, db } = setup({ status: 'DRAFT' });
    db.class.findMany.mockResolvedValue([
      { teacherId: 'old', pendingTeacherId: 'current', pendingTeacherFrom: new Date('2020-01-01') },
      {
        teacherId: 'future-old',
        pendingTeacherId: 'future',
        pendingTeacherFrom: new Date('2099-01-01'),
      },
    ]);
    await service.reviewers(designer, 'unit');
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['current', 'future-old'] }, role: 'TEACHER', status: 'ACTIVE' },
        select: { id: true, email: true, displayName: true },
      }),
    );
  });
});

describe('future curriculum revisions and separate tests', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-14T18:00:00Z')));
  afterEach(() => jest.restoreAllMocks());

  it('requires a period after both today in Vietnam and the source period', async () => {
    const { service, db } = setup({ status: 'APPROVED' });
    for (const fromDate of ['2026-10-15', '2026-10-31']) {
      await expect(
        service.reviseUnit(designer, 'unit', { title: 'Kỳ sau', fromDate, toDate: '2026-11-30' }),
      ).rejects.toMatchObject({ code: 'FUTURE_CURRICULUM_PERIOD_REQUIRED' });
    }
    expect(db.curriculumUnit.create).not.toHaveBeenCalled();
  });

  it('copies only regular lessons to a new period without changing the original', async () => {
    const { service, db, unit } = setup({ status: 'APPROVED' });
    unit.lessons.push({
      id: 'test',
      kind: 'MONTHLY_TEST',
      title: 'Đề cũ',
      content: 'Đề',
      sequence: 1,
    });
    await service.reviseUnit(designer, 'unit', {
      title: 'Toán 8 kỳ sau',
      fromDate: '2026-11-01',
      toDate: '2026-11-30',
    });
    expect(db.curriculumUnit.create).toHaveBeenCalledWith({
      data: containing({
        title: 'Toán 8 kỳ sau',
        basedOnId: 'unit',
        fromDate: new Date('2026-11-01T00:00:00Z'),
        toDate: new Date('2026-11-30T00:00:00Z'),
      }),
    });
    expect(db.lesson.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ kind: 'LESSON', unitId: 'future-unit', title: 'Bài 1' })],
    });
    expect(db.curriculumUnit.update).not.toHaveBeenCalled();
  });

  it('keeps structural validation while ignoring historic monthly tests', async () => {
    const { service, unit } = setup({ status: 'DRAFT' });
    unit.lessons.push({
      id: 'test',
      kind: 'MONTHLY_TEST',
      title: 'Cũ',
      content: 'Đề',
      sequence: 1,
    });
    await expect(service.validation(designer, 'unit')).resolves.toMatchObject({ ready: true });
    unit.lessons[0].sequence = 2;
    await expect(service.validation(designer, 'unit')).resolves.toMatchObject({
      ready: false,
      errors: [{ code: 'LESSON_SEQUENCE_GAP', message: expect.any(String) as unknown }],
    });
  });

  it('rejects new monthly tests and flags them in curriculum import previews', async () => {
    const { service, db } = setup({ status: 'DRAFT' });
    await expect(
      service.setMonthlyTest(designer, 'unit', { monthKey: '2026-10', title: 'Đề', content: 'Đề' }),
    ).rejects.toMatchObject({ code: 'TESTS_MANAGED_BY_TEACHER' });
    const csv = Buffer.from('kind,sequence,title,content,monthKey\nMONTHLY_TEST,,Đề,Đề,2026-10\n');
    await expect(
      service.importPreview(designer, 'unit', { buffer: csv } as Express.Multer.File, 'APPEND'),
    ).resolves.toMatchObject({
      summary: { invalidRows: 1 },
      rows: [
        expect.objectContaining({
          errors: [{ rowNumber: 2, field: 'kind', code: 'TESTS_MANAGED_BY_TEACHER' }],
        }),
      ],
    });
    expect(db.lesson.createMany).not.toHaveBeenCalled();
  });
});
