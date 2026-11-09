import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import type { AcademicRepository } from '../../src/modules/academic/academic.repository';
import { OutcomeService } from '../../src/modules/academic/outcome.service';
import { seedLearningOutcomes } from '../../src/database/seeds/seed-learning-outcomes';
import { SUBJECTS, TOPICS } from '../../src/database/seeds/curriculum-content';
import type { SeedCatalog } from '../../src/database/seeds/seed-catalog';
import type { SeedUsers } from '../../src/database/seeds/seed-accounts';
import type { Prisma } from '@prisma/client';

describe('CLO source safeguards', () => {
  it('seeds every requested subject and grade as unverified draft', async () => {
    const sets: Array<Record<string, unknown>> = [];
    const outcomes: Array<Record<string, unknown>> = [];
    const tx = {
      outcomeSet: {
        upsert: jest.fn(({ create }: { create: Record<string, unknown> }) => {
          sets.push(create);
          return Promise.resolve({ id: create.id });
        }),
      },
      learningOutcome: {
        upsert: jest.fn(({ create }: { create: Record<string, unknown> }) => {
          outcomes.push(create);
          return Promise.resolve({ id: create.id });
        }),
      },
      lessonOutcome: { upsert: jest.fn() },
    };
    const classes: SeedCatalog['classes'] = {};
    const lessons: SeedCatalog['lessons'] = {};
    for (const subject of SUBJECTS.filter((item) => item.key !== 'physics')) {
      for (const grade of [6, 7, 8, 9]) {
        const key = `${subject.key}-${grade}`;
        classes[`${key}-a`] = { programId: `program-${key}` } as SeedCatalog['classes'][string];
        lessons[key] = [];
      }
    }
    await seedLearningOutcomes(
      tx as unknown as Prisma.TransactionClient,
      { designer: { id: 'designer' }, 'designer-2': { id: 'designer-2' } } as unknown as SeedUsers,
      { classes, lessons } as SeedCatalog,
    );
    expect(sets).toHaveLength(12);
    expect(outcomes).toHaveLength(
      Object.entries(TOPICS)
        .filter(([key]) => /^(math|chemistry|biology)-[6-9]$/.test(key))
        .reduce((total, [, topics]) => total + topics.length, 0),
    );
    expect(outcomes).toHaveLength(48);
    expect(sets.every((item) => item.status === 'DRAFT')).toBe(true);
    expect(outcomes.every((item) => item.sourceStatus === 'CANDIDATE')).toBe(true);
    expect(outcomes.every((item) => String(item.sourceUrl).endsWith('.pdf'))).toBe(true);
  });

  interface ApprovalDb {
    $queryRaw: jest.Mock;
    program: { findMany: jest.Mock };
    class: { findMany: jest.Mock };
    user: Record<'findFirst' | 'findMany', jest.Mock>;
    curriculumUnit: { count: jest.Mock };
    learningOutcome: { updateMany: jest.Mock };
    outcomeSet: Record<'findUnique' | 'update', jest.Mock>;
  }

  interface LockedSet {
    status: string;
    programId: string;
    outcomes: Array<{ id: string; code: string; lessonLinks: unknown[] }>;
  }

  /** technicalApprove reads the set, its CLOs and their links only through locking queries. */
  function lockedSetRaw(set: LockedSet): jest.Mock {
    return jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM outcome_sets'))
        return Promise.resolve([{ status: set.status, programId: set.programId, level: 'L', version: 1 }]);
      if (sql.includes('FROM learning_outcomes'))
        return Promise.resolve(set.outcomes.map(({ id, code }) => ({ id, code })));
      if (sql.includes('FROM lesson_outcomes'))
        return Promise.resolve(
          set.outcomes.filter((outcome) => outcome.lessonLinks.length).map((outcome) => ({ outcomeId: outcome.id })),
        );
      return Promise.resolve([]);
    });
  }

  function approvalDb(set: LockedSet, chosenCurricula = 0): ApprovalDb {
    return {
      $queryRaw: lockedSetRaw(set),
      program: {
        findMany: jest.fn().mockResolvedValue([{ id: 'program', subject: 'Toán', subjectId: null }]),
      },
      class: {
        findMany: jest.fn().mockResolvedValue([
          { programId: 'program', teacherId: 'teacher', pendingTeacherId: null, pendingTeacherFrom: null },
        ]),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'teacher' }),
        findMany: jest.fn().mockResolvedValue([{ id: 'teacher' }]),
      },
      curriculumUnit: { count: jest.fn().mockResolvedValue(chosenCurricula) },
      learningOutcome: { updateMany: jest.fn() },
      outcomeSet: { findUnique: jest.fn(), update: jest.fn() },
    };
  }

  function serviceFor(db: unknown): OutcomeService {
    return new OutcomeService({
      db,
      transaction: (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work(db),
    } as unknown as AcademicRepository);
  }

  const teacher = { id: 'teacher', role: 'TEACHER' } as AuthenticatedUser;

  it('approves light CLOs without verified sources and verifies only the unverified ones', async () => {
    const set = {
      id: 'set',
      programId: 'program',
      status: 'DRAFT',
      outcomes: [
        { id: 'a', code: 'TOAN-8-01', sourceStatus: 'CANDIDATE', verifiedById: null, lessonLinks: [{ lessonId: 'l1' }] },
        { id: 'b', code: 'TOAN-8-02', sourceStatus: 'VERIFIED', verifiedById: 'teacher-x', lessonLinks: [{ lessonId: 'l2' }] },
      ],
    };
    const db = approvalDb(set);
    await serviceFor(db).technicalApprove(teacher, 'set');
    // A CLO verified by teacher-x keeps teacher-x: only unverified CLOs take the approver.
    expect(db.learningOutcome.updateMany).toHaveBeenCalledWith({
      where: { outcomeSetId: 'set', sourceStatus: { not: 'VERIFIED' } },
      data: expect.objectContaining({
        sourceStatus: 'VERIFIED',
        verifiedById: 'teacher',
        revision: { increment: 1 },
      }) as unknown,
    });
    expect(db.outcomeSet.update).toHaveBeenCalledWith({
      where: { id: 'set' },
      data: expect.objectContaining({ status: 'TECHNICALLY_APPROVED', reviewerId: 'teacher' }) as unknown,
    });
    // A plain read would use the TiDB snapshot taken before the lock wait.
    expect(db.outcomeSet.findUnique).not.toHaveBeenCalled();
    const sql = (db.$queryRaw.mock.calls as Array<[TemplateStringsArray]>).map(([strings]) => strings.join('?'));
    expect(sql).toHaveLength(3);
    expect(sql.every((query) => query.includes('FOR UPDATE'))).toBe(true);
  });

  it('sees a CLO created while the approval waited for the lock', async () => {
    const set: LockedSet = {
      status: 'DRAFT',
      programId: 'program',
      outcomes: [
        { id: 'a', code: 'TOAN-8-01', lessonLinks: [{ lessonId: 'l1' }] },
        // Committed by a designer just before this approval got the set lock: no lesson yet.
        { id: 'x', code: 'TOAN-8-09', lessonLinks: [] },
      ],
    };
    const db = approvalDb(set);
    await expect(serviceFor(db).technicalApprove(teacher, 'set')).rejects.toMatchObject({
      code: 'OUTCOME_SET_INCOMPLETE',
      details: { outcomeIds: ['x'], codes: ['TOAN-8-09'] },
    });
    expect(db.learningOutcome.updateMany).not.toHaveBeenCalled();
  });

  it('still refuses a CLO without a lesson and names it in details', async () => {
    const set = {
      id: 'set',
      programId: 'program',
      status: 'DRAFT',
      outcomes: [
        { id: 'a', code: 'TOAN-8-01', sourceStatus: 'CANDIDATE', verifiedById: null, lessonLinks: [] },
        { id: 'b', code: 'TOAN-8-02', sourceStatus: 'CANDIDATE', verifiedById: null, lessonLinks: [{ lessonId: 'l' }] },
      ],
    };
    const db = approvalDb(set);
    await expect(serviceFor(db).technicalApprove(teacher, 'set')).rejects.toMatchObject({
      code: 'OUTCOME_SET_INCOMPLETE',
      statusCode: 409,
      details: { outcomeIds: ['a'], codes: ['TOAN-8-01'] },
    });
    expect(db.learningOutcome.updateMany).not.toHaveBeenCalled();
    expect(db.outcomeSet.update).not.toHaveBeenCalled();
    await expect(
      serviceFor(approvalDb({ ...set, outcomes: [] })).technicalApprove(teacher, 'set'),
    ).rejects.toMatchObject({ code: 'OUTCOME_SET_INCOMPLETE', details: { codes: [] } });
  });

  describe('who may review the CLO set of a program (Q3, C15)', () => {
    const set = {
      id: 'set',
      programId: 'program',
      status: 'DRAFT',
      outcomes: [{ id: 'a', code: 'SINH-8-01', sourceStatus: 'CANDIDATE', verifiedById: null, lessonLinks: [{ lessonId: 'l' }] }],
    };

    /** No class of the subject anywhere: the teacher only qualifies as a chosen curriculum reviewer. */
    function unrelatedTeacherDb(chosenCurricula: number): ApprovalDb {
      const db = approvalDb(set, chosenCurricula);
      db.program.findMany.mockResolvedValue([{ id: 'program', subject: 'Sinh học', subjectId: null }]);
      db.class.findMany.mockResolvedValue([]);
      db.user.findMany.mockResolvedValue([]);
      return db;
    }

    it('lets the teacher chosen for a curriculum of the program review its CLO set', async () => {
      const db = unrelatedTeacherDb(1);
      await serviceFor(db).technicalApprove(teacher, 'set');
      expect(db.outcomeSet.update).toHaveBeenCalled();
      const [query] = db.curriculumUnit.count.mock.calls[0] as [{ where: unknown }];
      expect(query.where).toEqual({
        programId: 'program',
        reviewerTeacherId: 'teacher',
        OR: [
          { status: 'PENDING_REVIEW' },
          { status: 'APPROVED', technicalReviewedAt: { not: null } },
          { status: 'ARCHIVED', technicalReviewedAt: { not: null }, approvedAt: { not: null } },
        ],
      });
    });

    it('never opens the set to any teacher when no curriculum chose them', async () => {
      const db = unrelatedTeacherDb(0);
      await expect(serviceFor(db).technicalApprove(teacher, 'set')).rejects.toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
      });
      expect(db.outcomeSet.update).not.toHaveBeenCalled();
    });

    it('lets a teacher of the same subject in another grade review it', async () => {
      const db = approvalDb(set);
      db.program.findMany.mockResolvedValue([
        { id: 'program', subject: 'Sinh học', subjectId: null },
        { id: 'program-9', subject: 'sinh  hoc', subjectId: null },
      ]);
      db.class.findMany.mockResolvedValue([
        { programId: 'program-9', teacherId: 'teacher', pendingTeacherId: null, pendingTeacherFrom: null },
      ]);
      await serviceFor(db).technicalApprove(teacher, 'set');
      expect(db.outcomeSet.update).toHaveBeenCalled();
      expect(db.curriculumUnit.count).not.toHaveBeenCalled();
    });

    it('refuses an inactive teacher', async () => {
      const db = approvalDb(set, 1);
      db.user.findFirst.mockResolvedValue(null);
      await expect(serviceFor(db).technicalApprove(teacher, 'set')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });
});
