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
      | 'findUnique'
      | 'findUniqueOrThrow'
      | 'findMany'
      | 'update'
      | 'updateMany'
      | 'aggregate'
      | 'create',
      jest.Mock
    >;
    class: Record<'count' | 'findMany', jest.Mock>;
    program: { findMany: jest.Mock };
    user: Record<'findFirst' | 'findMany', jest.Mock>;
    lesson: Record<'updateMany' | 'createMany', jest.Mock>;
    lessonOutcome: Record<'findMany' | 'createMany', jest.Mock>;
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
    approvedAt: null as Date | null,
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
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      aggregate: jest.fn().mockResolvedValue({ _max: { version: null } }),
      create: jest.fn().mockResolvedValue({ id: 'future-unit' }),
    },
    class: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]) },
    program: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'program', subject: 'Toán', subjectId: 'math' },
        { id: 'program-9', subject: 'Toán', subjectId: 'math' },
        { id: 'physics', subject: 'Vật lý', subjectId: 'phys' },
      ]),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: teacher.id, role: 'TEACHER', status: 'ACTIVE' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    lesson: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), createMany: jest.fn() },
    lessonOutcome: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() },
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

  it('blocks the chosen teacher from reviewing once their account is locked', async () => {
    const { service, db } = setup();
    db.user.findFirst.mockResolvedValue(null);
    await expect(
      service.technicalReview(teacher, 'unit', { approved: true, expectedRevision: 5 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(db.curriculumUnit.update).not.toHaveBeenCalled();
  });

  it('lets the chosen teacher review after the program got another teacher (B4-5)', async () => {
    const { service, db } = setup();
    // The program now has its own teacher, so the ANY group that chose this reviewer is gone.
    db.class.findMany.mockResolvedValue([
      { programId: 'program', teacherId: 'newcomer', pendingTeacherId: null, pendingTeacherFrom: null },
    ]);
    await service.technicalReview(teacher, 'unit', { approved: true, expectedRevision: 5 });
    expect(db.curriculumUnit.update).toHaveBeenCalledWith(
      containing({ data: containing({ status: 'PENDING_REVIEW' }) }),
    );
  });

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

  it('checks all published periods under the program lock before approving lessons', async () => {
    const { service, db } = setup({ technicalReviewedAt: new Date() });
    db.curriculumUnit.findMany.mockResolvedValueOnce([
      {
        id: 'other',
        title: 'Kỳ đã duyệt',
        fromDate: new Date('2026-10-31'),
        toDate: new Date('2026-11-30'),
      },
    ]);
    await expect(service.approveUnit(manager, 'unit')).rejects.toMatchObject({
      code: 'CURRICULUM_EFFECTIVE_PERIOD_CONFLICT',
      details: { programId: 'program', conflicts: [{ id: 'other' }] },
    });
    expect(String((db.$queryRaw.mock.calls[0] as unknown[])[0])).toContain('FROM programs');
    expect(String((db.$queryRaw.mock.calls[1] as unknown[])[0])).toContain('FROM curriculum_units');
    expect(db.lesson.updateMany).not.toHaveBeenCalled();
    expect(db.curriculumUnit.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
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
    // Another teacher runs a class of the program, so the chosen teacher is outside every group.
    db.class.findMany.mockResolvedValueOnce([
      { programId: 'program', teacherId: 'owner', pendingTeacherId: null, pendingTeacherFrom: null },
    ]);
    db.user.findMany.mockResolvedValueOnce([{ id: 'owner' }]);
    await expect(
      service.submitUnit(designer, 'unit', { reviewerTeacherId: teacher.id }),
    ).rejects.toMatchObject({ code: 'INVALID_CURRICULUM_REVIEWER', statusCode: 400 });
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
      {
        programId: 'program',
        teacherId: 'old',
        pendingTeacherId: 'current',
        pendingTeacherFrom: new Date('2020-01-01'),
      },
      {
        programId: 'program',
        teacherId: 'future-old',
        pendingTeacherId: 'future',
        pendingTeacherFrom: new Date('2099-01-01'),
      },
    ]);
    db.user.findMany
      .mockResolvedValueOnce([{ id: 'current' }, { id: 'future-old' }])
      .mockResolvedValueOnce([
        { id: 'current', email: 'c@x', displayName: 'C' },
        { id: 'future-old', email: 'f@x', displayName: 'F' },
      ]);
    await expect(service.reviewers(designer, 'unit')).resolves.toEqual([
      { id: 'current', email: 'c@x', displayName: 'C', reason: 'PROGRAM' },
      { id: 'future-old', email: 'f@x', displayName: 'F', reason: 'PROGRAM' },
    ]);
    expect(db.user.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { role: 'TEACHER', status: 'ACTIVE', id: { in: ['current', 'future-old'] } },
        select: { id: true, email: true, displayName: true },
      }),
    );
  });

  describe('reviewer groups (B4)', () => {
    const classOf = (
      programId: string,
      teacherId: string,
    ): { programId: string; teacherId: string; pendingTeacherId: null; pendingTeacherFrom: null } => ({
      programId,
      teacherId,
      pendingTeacherId: null,
      pendingTeacherFrom: null,
    });

    it('ranks teachers of the program before teachers of the same subject in other grades', async () => {
      const { service, db } = setup({ status: 'DRAFT' });
      db.class.findMany.mockResolvedValue([
        classOf('program-9', 'subject-teacher'),
        classOf('program', 'program-teacher'),
        classOf('program-9', 'program-teacher'),
      ]);
      db.user.findMany
        .mockResolvedValueOnce([{ id: 'subject-teacher' }, { id: 'program-teacher' }])
        // Sorted by name, the subject teacher comes first; the group order must still win.
        .mockResolvedValueOnce([
          { id: 'subject-teacher', email: 'a@x', displayName: 'An' },
          { id: 'program-teacher', email: 'b@x', displayName: 'Bình' },
        ]);
      const result = (await service.reviewers(designer, 'unit', {
        page: 1,
        limit: 20,
        paginated: true,
      })) as { items: Array<{ id: string; reason: string }>; total: number };
      expect(result.items.map((item) => [item.id, item.reason])).toEqual([
        ['program-teacher', 'PROGRAM'],
        ['subject-teacher', 'SUBJECT'],
      ]);
      expect(result.total).toBe(2);
      // Only programs of the same subject are searched for classes.
      expect(db.class.findMany).toHaveBeenCalledWith(
        containing({ where: { programId: { in: ['program', 'program-9'] }, isActive: true } }),
      );
    });

    it('accepts a teacher of the same subject when the program has no class yet', async () => {
      const { service, db } = setup({ status: 'DRAFT' });
      db.class.findMany.mockResolvedValue([classOf('program-9', teacher.id)]);
      db.user.findMany.mockResolvedValue([{ id: teacher.id }]);
      await service.submitUnit(designer, 'unit', { reviewerTeacherId: teacher.id });
      expect(db.curriculumUnit.update).toHaveBeenCalledWith(
        containing({ data: containing({ status: 'PENDING_REVIEW', reviewerTeacherId: teacher.id }) }),
      );
    });

    it('falls back to every active teacher only when no teacher teaches the subject', async () => {
      const { service, db } = setup({ status: 'DRAFT' });
      db.class.findMany.mockResolvedValue([]);
      db.user.findMany.mockResolvedValue([{ id: 'anyone', email: 'z@x', displayName: 'Z' }]);
      await expect(service.reviewers(designer, 'unit', { page: 1, limit: 20, search: 'Z' })).resolves.toEqual([
        { id: 'anyone', email: 'z@x', displayName: 'Z', reason: 'ANY' },
      ]);
      expect(db.user.findMany).toHaveBeenLastCalledWith(
        containing({
          where: {
            role: 'TEACHER',
            status: 'ACTIVE',
            OR: [{ displayName: { contains: 'Z' } }, { email: { contains: 'Z' } }],
          },
          take: 20,
          skip: 0,
        }),
      );
      await service.submitUnit(designer, 'unit', { reviewerTeacherId: teacher.id });
      expect(db.curriculumUnit.update).toHaveBeenCalled();
    });

    it('never accepts an inactive teacher, even from ANY', async () => {
      const { service, db } = setup({ status: 'DRAFT' });
      db.user.findFirst.mockResolvedValue(null);
      await expect(
        service.submitUnit(designer, 'unit', { reviewerTeacherId: 'locked' }),
      ).rejects.toMatchObject({ code: 'INVALID_CURRICULUM_REVIEWER' });
    });

    it('does not let a search switch the list to ANY', async () => {
      const { service, db } = setup({ status: 'DRAFT' });
      db.class.findMany.mockResolvedValue([classOf('program', 'program-teacher')]);
      db.user.findMany.mockResolvedValueOnce([{ id: 'program-teacher' }]).mockResolvedValueOnce([]);
      await expect(
        service.reviewers(designer, 'unit', { page: 1, limit: 20, search: 'nobody' }),
      ).resolves.toEqual([]);
    });
  });

  describe('shared drafts (B2, Q6)', () => {
    const other = { id: 'designer-2', role: 'CURRICULUM_DESIGNER' } as AuthenticatedUser;

    it('lets another designer read, edit and submit the draft, auditing that designer', async () => {
      const { service, db } = setup({ status: 'DRAFT' });
      await expect(service.unit(other, 'unit')).resolves.toMatchObject({ id: 'unit' });
      await service.updateUnit(other, 'unit', { title: 'Toán 8 mới', expectedRevision: 5 });
      await service.submitUnit(other, 'unit', { reviewerTeacherId: teacher.id });
      expect(db.auditLog.create).toHaveBeenCalledWith(
        containing({
          data: containing({ actorUserId: other.id, action: 'CURRICULUM_UNIT_SUBMITTED' }),
        }),
      );
    });

    it('still refuses a stale revision and a teacher', async () => {
      const { service } = setup({ status: 'DRAFT' });
      await expect(
        service.updateUnit(other, 'unit', { title: 'X', expectedRevision: 4 }),
      ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
      await expect(
        service.updateUnit(teacher, 'unit', { title: 'X', expectedRevision: 5 }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    });

    it('lists every curriculum for any designer', async () => {
      const { service, db } = setup();
      await service.listUnits(other, {});
      const [query] = db.curriculumUnit.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
      expect(query.where).not.toHaveProperty('designerId');
    });
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

  it('copies a previously approved archived source without changing its publication history', async () => {
    const { service, db } = setup({ status: 'ARCHIVED', approvedAt: new Date('2026-09-20') });
    await service.reviseUnit(designer, 'unit', {
      title: 'Kỳ tiếp theo',
      fromDate: '2026-11-01',
      toDate: '2026-11-30',
    });
    expect(db.curriculumUnit.create).toHaveBeenCalledWith(
      containing({
        data: containing({ basedOnId: 'unit', fromDate: new Date('2026-11-01') }),
      }),
    );
    expect(db.curriculumUnit.update).not.toHaveBeenCalled();
  });

  it('does not treat an archived unit without approval history as a revision source', async () => {
    const { service, db } = setup({ status: 'ARCHIVED', approvedAt: null });
    await expect(
      service.reviseUnit(designer, 'unit', {
        title: 'Kỳ tiếp theo',
        fromDate: '2026-11-01',
        toDate: '2026-11-30',
      }),
    ).rejects.toMatchObject({ code: 'UNIT_NOT_APPROVED' });
    expect(db.curriculumUnit.create).not.toHaveBeenCalled();
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

  it('keeps CSV_INVALID and adds the structural problem and its rows as details', async () => {
    const { service, db } = setup({ status: 'DRAFT' });
    const csv = Buffer.from(
      'kind,sequence,title,content,monthKey,csvVersion\nLESSON,1,Bài 1,A,,1\nLESSON,2,Bài 2,B,,3\n',
    );
    await expect(
      service.importPreview(designer, 'unit', { buffer: csv } as Express.Multer.File, 'APPEND'),
    ).rejects.toMatchObject({
      code: 'CSV_INVALID',
      statusCode: 400,
      message: 'CSV_UNSUPPORTED_VERSION',
      details: {
        code: 'CSV_UNSUPPORTED_VERSION',
        rows: [{ code: 'CSV_UNSUPPORTED_VERSION', rowNumber: 3 }],
        rowErrorCount: 1,
      },
    });
    expect(db.curriculumImportPreview.create).not.toHaveBeenCalled();
  });
});
