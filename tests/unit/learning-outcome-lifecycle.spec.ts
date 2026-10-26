import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import type { AcademicRepository } from '../../src/modules/academic/academic.repository';
import { OutcomeService } from '../../src/modules/academic/outcome.service';
import { CurriculumSchedulingService } from '../../src/modules/curriculum-scheduling/curriculum-scheduling.service';
import type { DatabaseService } from '../../src/database/orm/database.service';
import type { NotificationEventsService } from '../../src/modules/notifications/notification-events.service';

const manager = { id: 'manager', role: 'MANAGER' } as AuthenticatedUser;
const designer = { id: 'designer', role: 'CURRICULUM_DESIGNER' } as AuthenticatedUser;

function outcomeService(db: Record<string, unknown>): OutcomeService {
  return new OutcomeService({
    db,
    transaction: (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work(db),
  } as unknown as AcademicRepository);
}

describe('CLO lifecycle across curriculum periods', () => {
  it('copies lesson CLO links into the lessons of a revised curriculum period', async () => {
    const unit = {
      id: 'unit-1',
      programId: 'program-1',
      trackId: 'track-1',
      designerId: 'designer',
      status: 'APPROVED',
      approvedAt: new Date('2026-01-01T00:00:00Z'),
      toDate: new Date('2026-12-31T00:00:00Z'),
      lessons: [
        { id: 'old-1', kind: 'LESSON', sequence: 1, title: 'Bài 1', content: 'a' },
        { id: 'old-2', kind: 'LESSON', sequence: 2, title: 'Bài 2', content: 'b' },
      ],
    };
    const createLinks = jest.fn().mockResolvedValue({ count: 3 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      curriculumUnit: {
        findUnique: jest.fn().mockResolvedValue(unit),
        aggregate: jest.fn().mockResolvedValue({ _max: { version: null } }),
        create: jest.fn().mockResolvedValue({ id: 'unit-2' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'unit-2' }),
      },
      lesson: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'new-1', sequence: 1 },
          { id: 'new-2', sequence: 2 },
        ]),
      },
      lessonOutcome: {
        findMany: jest.fn().mockResolvedValue([
          { lessonId: 'old-1', outcomeId: 'clo-a' },
          { lessonId: 'old-1', outcomeId: 'clo-b' },
          { lessonId: 'old-2', outcomeId: 'clo-c' },
        ]),
        createMany: createLinks,
      },
    };
    const db = {
      curriculumUnit: { findUnique: jest.fn().mockResolvedValue({ programId: 'program-1' }) },
      $transaction: (work: (client: unknown) => Promise<unknown>) => work(tx),
    } as unknown as DatabaseService;
    const service = new CurriculumSchedulingService(db, {} as NotificationEventsService);
    await service.reviseUnit(designer, 'unit-1', {
      title: 'Toán 8 kỳ sau',
      fromDate: '2099-01-04',
      toDate: '2099-06-30',
    });
    expect(createLinks).toHaveBeenCalledWith({
      data: [
        { lessonId: 'new-1', outcomeId: 'clo-a' },
        { lessonId: 'new-1', outcomeId: 'clo-b' },
        { lessonId: 'new-2', outcomeId: 'clo-c' },
      ],
      skipDuplicates: true,
    });
  });

  it('maps a draft lesson to CLOs of an approved set in the same program', async () => {
    const createMany = jest.fn();
    const db = {
      lesson: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'lesson-1',
          programId: 'program-1',
          designerId: 'designer',
          status: 'DRAFT',
        }),
      },
      learningOutcome: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'clo-a', outcomeSet: { programId: 'program-1', status: 'APPROVED' } },
          ]),
      },
      lessonOutcome: { deleteMany: jest.fn(), createMany },
    };
    await expect(
      outcomeService(db).setLessonOutcomes(designer, 'lesson-1', ['clo-a']),
    ).resolves.toEqual({ lessonId: 'lesson-1', outcomeIds: ['clo-a'] });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ lessonId: 'lesson-1', outcomeId: 'clo-a' }],
    });
    db.learningOutcome.findMany.mockResolvedValue([
      { id: 'clo-x', outcomeSet: { programId: 'program-2', status: 'APPROVED' } },
    ]);
    await expect(
      outcomeService(db).setLessonOutcomes(designer, 'lesson-1', ['clo-x']),
    ).rejects.toThrow('same program');
  });
});

describe('CLO set review loop', () => {
  it('lets the manager send a teacher-reviewed set back to draft with a reason', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'set-1', status: 'DRAFT' });
    const auditLog = { create: jest.fn() };
    const db = {
      outcomeSet: {
        findUnique: jest.fn().mockResolvedValue({ id: 'set-1', status: 'TECHNICALLY_APPROVED' }),
        update,
      },
      auditLog,
    };
    await outcomeService(db).requestChanges(manager, 'set-1', '  CLO-02 chưa đo được  ');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'set-1' },
      data: {
        status: 'DRAFT',
        reviewNote: 'CLO-02 chưa đo được',
        reviewerId: null,
        reviewedAt: null,
      },
    });
    expect(auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'OUTCOME_SET_CHANGES_REQUESTED',
          entityId: 'set-1',
        }) as unknown,
      }),
    );
  });

  it('refuses to reopen a draft or an already approved set', async () => {
    const db = {
      outcomeSet: { findUnique: jest.fn().mockResolvedValue({ id: 'set-1', status: 'APPROVED' }) },
    };
    await expect(outcomeService(db).requestChanges(manager, 'set-1', 'Cần sửa')).rejects.toThrow(
      'Only a teacher-reviewed set',
    );
    await expect(outcomeService(db).requestChanges(designer, 'set-1', 'Cần sửa')).rejects.toThrow();
  });

  it('starts a new draft version from an earlier set, copying CLOs and lesson links unverified', async () => {
    const createdOutcomes: Array<Record<string, unknown>> = [];
    const createLinks = jest.fn();
    const db = {
      curriculumUnit: { count: jest.fn().mockResolvedValue(1) },
      outcomeSet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'set-1',
          programId: 'program-1',
          level: 'Lớp 8 - cơ bản',
          outcomes: [
            {
              id: 'clo-old',
              code: 'TOAN-8-01',
              title: 'Phương trình',
              statement: 'Giải phương trình bậc nhất',
              sourceTitle: 'CT Toán',
              sourceUrl: 'https://example.com/toan.pdf',
              sourceLocator: 'Lớp 8, trang in 65',
              sourceNote: 'đã xác minh',
              sourceStatus: 'VERIFIED',
              verifiedById: 'teacher',
              verifiedAt: new Date(),
              required: true,
              lessonLinks: [{ lessonId: 'lesson-1' }],
            },
          ],
        }),
        findFirst: jest.fn().mockResolvedValue({ version: 2 }),
        create: jest.fn().mockResolvedValue({ id: 'set-3', version: 3 }),
      },
      learningOutcome: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          createdOutcomes.push(data);
          return Promise.resolve({ id: 'clo-new' });
        }),
      },
      lessonOutcome: { createMany: createLinks },
    };
    await outcomeService(db).createSet(designer, 'program-1', 'Lớp 8 - cơ bản', 'set-1');
    expect(db.outcomeSet.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 3,
        programId: 'program-1',
        designerId: 'designer',
      }) as unknown,
    });
    expect(createdOutcomes).toEqual([
      expect.objectContaining({
        outcomeSetId: 'set-3',
        code: 'TOAN-8-01',
        sourceStatus: 'CANDIDATE',
        verifiedById: null,
        verifiedAt: null,
      }),
    ]);
    expect(createLinks).toHaveBeenCalledWith({
      data: [{ lessonId: 'lesson-1', outcomeId: 'clo-new' }],
    });
    db.outcomeSet.findUnique.mockResolvedValue({
      id: 'set-9',
      programId: 'program-2',
      outcomes: [],
    });
    await expect(
      outcomeService(db).createSet(designer, 'program-1', 'Lớp 8 - cơ bản', 'set-9'),
    ).rejects.toThrow('same program');
  });
});
