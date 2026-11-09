import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import type { DatabaseService } from '../../src/database/orm/database.service';
import type { ImportCommitDto } from '../../src/modules/curriculum-scheduling/curriculum-scheduling.dto';
import { CurriculumSchedulingService } from '../../src/modules/curriculum-scheduling/curriculum-scheduling.service';
import type { NotificationEventsService } from '../../src/modules/notifications/notification-events.service';

const designer = { id: 'designer', role: 'CURRICULUM_DESIGNER' } as AuthenticatedUser;

interface CleanupDb {
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
  curriculumUnit: Record<'findUnique' | 'update' | 'count' | 'delete', jest.Mock>;
  classSession: { count: jest.Mock };
  curriculumFeedback: { count: jest.Mock };
  scheduleGeneration: { count: jest.Mock };
  lesson: Record<'delete' | 'deleteMany' | 'update' | 'createMany' | 'count', jest.Mock>;
  lessonOutcome: { deleteMany: jest.Mock };
  curriculumImportPreview: Record<'deleteMany' | 'findUnique', jest.Mock>;
  curriculumImportCommit: Record<'deleteMany' | 'findUnique' | 'create', jest.Mock>;
}

const previewRows = [
  { rowNumber: 2, kind: 'LESSON' as const, sequence: 1, title: 'Bài mới', content: 'Nội dung' },
];

function setup(): { db: CleanupDb; service: CurriculumSchedulingService } {
  const unit = {
    id: 'unit',
    programId: 'program',
    designerId: designer.id,
    status: 'DRAFT',
    revision: 3,
    lessons: [
      { id: 'lesson-1', kind: 'LESSON', sequence: 1, title: 'Bài 1', content: 'A' },
      { id: 'lesson-2', kind: 'LESSON', sequence: 2, title: 'Bài 2', content: 'B' },
    ],
  };
  const db: CleanupDb = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
    curriculumUnit: {
      findUnique: jest.fn().mockResolvedValue(unit),
      update: jest.fn().mockResolvedValue({ revision: 4 }),
      count: jest.fn().mockResolvedValue(0),
      delete: jest.fn(),
    },
    classSession: { count: jest.fn().mockResolvedValue(0) },
    curriculumFeedback: { count: jest.fn().mockResolvedValue(0) },
    scheduleGeneration: { count: jest.fn().mockResolvedValue(0) },
    lesson: {
      delete: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
      createMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    lessonOutcome: { deleteMany: jest.fn() },
    curriculumImportPreview: {
      deleteMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue({
        id: 'preview',
        unitId: 'unit',
        actorUserId: designer.id,
        mode: 'REPLACE',
        expectedRevision: 3,
        expiresAt: new Date(Date.now() + 60_000),
        rows: previewRows,
      }),
    },
    curriculumImportCommit: {
      deleteMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
  };
  db.$transaction.mockImplementation((work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
    work(db as unknown as Prisma.TransactionClient),
  );
  return {
    db,
    service: new CurriculumSchedulingService(
      db as unknown as DatabaseService,
      { curriculum: jest.fn() } as unknown as NotificationEventsService,
    ),
  };
}

function calledBefore(first: jest.Mock, second: jest.Mock): boolean {
  return first.mock.invocationCallOrder[0] < second.mock.invocationCallOrder[0];
}

describe('deleting draft lessons that carry CLO links', () => {
  it('removes the CLO links of a lesson before deleting it', async () => {
    const { db, service } = setup();
    await expect(service.deleteLesson(designer, 'unit', 'lesson-1')).resolves.toEqual({
      id: 'lesson-1',
      deleted: true,
    });
    expect(db.lessonOutcome.deleteMany).toHaveBeenCalledWith({ where: { lessonId: 'lesson-1' } });
    expect(calledBefore(db.lessonOutcome.deleteMany, db.lesson.delete)).toBe(true);
  });

  it('keeps the links when the lesson has teaching history and cannot be deleted', async () => {
    const { db, service } = setup();
    db.classSession.count.mockResolvedValue(1);
    await expect(service.deleteLesson(designer, 'unit', 'lesson-1')).rejects.toMatchObject({
      code: 'LESSON_IN_USE',
    });
    expect(db.lessonOutcome.deleteMany).not.toHaveBeenCalled();
  });

  it('removes the CLO links of every lesson before deleting a draft unit', async () => {
    const { db, service } = setup();
    await expect(service.deleteUnit(designer, 'unit')).resolves.toEqual({
      id: 'unit',
      deleted: true,
    });
    expect(db.lessonOutcome.deleteMany).toHaveBeenCalledWith({
      where: { lesson: { unitId: 'unit' } },
    });
    expect(calledBefore(db.lessonOutcome.deleteMany, db.lesson.deleteMany)).toBe(true);
  });

  it('removes the CLO links of replaced lessons in a REPLACE import', async () => {
    const { db, service } = setup();
    const input = {
      previewId: 'preview',
      expectedRevision: 3,
      mode: 'REPLACE',
      rows: previewRows,
    } as ImportCommitDto;
    await service.importCommit(designer, 'unit', input, 'key-1');
    expect(db.lessonOutcome.deleteMany).toHaveBeenCalledWith({
      where: { lesson: { unitId: 'unit', kind: 'LESSON' } },
    });
    expect(calledBefore(db.lessonOutcome.deleteMany, db.lesson.deleteMany)).toBe(true);
    expect(db.lesson.createMany).toHaveBeenCalled();
  });
});
