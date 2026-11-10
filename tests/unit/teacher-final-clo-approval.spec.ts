import { OutcomeService } from '../../src/modules/academic/outcome.service';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';

describe('teacher final CLO approval', () => {
  const teacher = { id: 'teacher', role: 'TEACHER' } as AuthenticatedUser;
  let setStatus = 'DRAFT';
  // technicalApprove reads the set, its CLOs and their lesson links only through locking queries.
  const lock = jest.fn((strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('FROM outcome_sets'))
      return Promise.resolve([{ status: setStatus, programId: 'program', level: 'L', version: 1 }]);
    if (sql.includes('FROM learning_outcomes'))
      return Promise.resolve([{ id: 'clo', code: 'TOAN-8-01' }]);
    if (sql.includes('FROM lesson_outcomes')) return Promise.resolve([{ outcomeId: 'clo' }]);
    return Promise.resolve([]);
  });
  const update = jest
    .fn<Promise<unknown>, [unknown]>()
    .mockResolvedValue({ id: 'set', status: 'APPROVED' });
  const findClasses = jest.fn<Promise<unknown>, [unknown]>();
  const tx = {
    $queryRaw: lock,
    program: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'program', subject: 'Toán', subjectId: null }]),
    },
    class: { findMany: findClasses },
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: teacher.id }),
      findMany: jest.fn().mockResolvedValue([{ id: teacher.id }]),
    },
    curriculumUnit: { count: jest.fn().mockResolvedValue(0) },
    learningOutcome: { updateMany: jest.fn() },
    outcomeSet: { update },
  };
  const service = new OutcomeService({
    db: tx,
    transaction: (work: (db: typeof tx) => Promise<unknown>) => work(tx),
  } as never);
  beforeEach(() => {
    jest.clearAllMocks();
    setStatus = 'DRAFT';
    findClasses.mockResolvedValue([
      {
        programId: 'program',
        teacherId: teacher.id,
        pendingTeacherId: null,
        pendingTeacherFrom: null,
      },
    ]);
  });
  it('makes a complete set usable immediately, attributing final approval to the teacher', async () => {
    await expect(service.technicalApprove(teacher, 'set')).resolves.toMatchObject({
      status: 'APPROVED',
    });
    expect(update.mock.calls[0][0]).toMatchObject({
      where: { id: 'set' },
      data: {
        status: 'APPROVED',
        reviewerId: teacher.id,
        approvedById: teacher.id,
        reviewNote: null,
      },
    });
    expect(update.mock.calls[0][0]).toMatchObject({
      data: { approvedAt: expect.any(Date) as unknown, reviewedAt: expect.any(Date) as unknown },
    });
    // The set row is locked before anything else is read.
    expect(lock.mock.calls[0][0].join('?')).toContain('FROM outcome_sets');
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
      findClasses.mock.invocationCallOrder[0],
    );
  });
  it.each(['MANAGER', 'CURRICULUM_DESIGNER', 'PARENT'] as const)(
    'does not allow %s to bypass the teacher review',
    async (role) => {
      await expect(service.technicalApprove({ ...teacher, role }, 'set')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(update).not.toHaveBeenCalled();
    },
  );
  it('requires a teacher who may review the program', async () => {
    findClasses.mockResolvedValue([
      { programId: 'program', teacherId: 'other', pendingTeacherId: null, pendingTeacherFrom: null },
    ]);
    await expect(service.technicalApprove(teacher, 'set')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(update).not.toHaveBeenCalled();
  });
  it('keeps approved versions locked instead of approving them again', async () => {
    setStatus = 'APPROVED';
    await expect(service.technicalApprove(teacher, 'set')).rejects.toMatchObject({
      code: 'OUTCOME_SET_LOCKED',
    });
    expect(update).not.toHaveBeenCalled();
  });
});
