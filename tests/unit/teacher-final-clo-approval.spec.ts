import { OutcomeService } from '../../src/modules/academic/outcome.service';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';

describe('teacher final CLO approval', () => {
  const teacher = { id: 'teacher', role: 'TEACHER' } as AuthenticatedUser;
  const lock = jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue([]);
  const update = jest
    .fn<Promise<unknown>, [unknown]>()
    .mockResolvedValue({ id: 'set', status: 'APPROVED' });
  const findUnique = jest.fn<Promise<unknown>, [unknown]>();
  const findClasses = jest.fn<Promise<unknown>, [unknown]>();
  const tx = {
    $queryRaw: lock,
    class: { findMany: findClasses },
    outcomeSet: { findUnique, update },
  };
  const service = new OutcomeService({
    db: tx,
    transaction: (work: (db: typeof tx) => Promise<unknown>) => work(tx),
  } as never);
  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue({
      id: 'set',
      programId: 'program',
      status: 'DRAFT',
      outcomes: [
        {
          sourceStatus: 'VERIFIED',
          verifiedById: teacher.id,
          lessonLinks: [{ lessonId: 'lesson' }],
        },
      ],
    });
    findClasses.mockResolvedValue([
      { teacherId: teacher.id, pendingTeacherId: null, pendingTeacherFrom: null },
    ]);
  });
  it('makes a fully verified set usable immediately, attributing final approval to the teacher', async () => {
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
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(findUnique.mock.invocationCallOrder[0]);
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
  it('requires the teacher to be assigned to a class of the program', async () => {
    findClasses.mockResolvedValue([
      { teacherId: 'other', pendingTeacherId: null, pendingTeacherFrom: null },
    ]);
    await expect(service.technicalApprove(teacher, 'set')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(update).not.toHaveBeenCalled();
  });
  it('keeps approved versions locked instead of approving them again', async () => {
    findUnique.mockResolvedValue({ id: 'set', programId: 'program', status: 'APPROVED' });
    await expect(service.technicalApprove(teacher, 'set')).rejects.toMatchObject({
      code: 'OUTCOME_SET_LOCKED',
    });
    expect(update).not.toHaveBeenCalled();
  });
});
