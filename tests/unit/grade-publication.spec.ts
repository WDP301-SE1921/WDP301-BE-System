import { AssessmentService } from '../../src/modules/academic/assessment.service';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';

describe('latest grade approval and publication', () => {
  const teacher = { id: 'teacher', role: 'TEACHER' } as AuthenticatedUser;
  const update = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({ id: 'grade' });
  const updateMany = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({ count: 1 });
  const lock = jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue([]);
  const findUniqueOrThrow = jest.fn<Promise<unknown>, [unknown]>();
  const latest = jest.fn<Promise<unknown>, [unknown]>();
  const family = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined);
  const tx = {
    $queryRaw: lock,
    gradeReview: { findUniqueOrThrow, findFirst: latest, update, updateMany },
  };
  const service = new AssessmentService(
    { transaction: (work: (db: typeof tx) => Promise<unknown>) => work(tx) } as never,
    {} as never,
    { family } as never,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(service, 'teacher').mockResolvedValue({} as never);
    latest.mockResolvedValue({ id: 'grade' });
    findUniqueOrThrow.mockResolvedValue({
      id: 'grade',
      submissionId: 'submission',
      revision: 1,
      status: 'APPROVED',
      submission: {
        recipientId: 'recipient',
        recipient: { assignmentId: 'assignment', enrollmentId: 'enrollment' },
      },
    });
  });
  it.each(['approveGrade', 'publishGrade'] as const)(
    'rejects an older revision in %s',
    async (action) => {
      latest.mockResolvedValue({ id: 'newer-grade' });
      await expect(service[action](teacher, 'grade')).rejects.toMatchObject({
        code: 'GRADE_REVISION_CONFLICT',
      });
      expect(update).not.toHaveBeenCalled();
      expect(updateMany).not.toHaveBeenCalled();
      expect(family).not.toHaveBeenCalled();
    },
  );
  it('locks the submission before reading and publishes the current approved revision', async () => {
    await service.publishGrade(teacher, 'grade');
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
      findUniqueOrThrow.mock.invocationCallOrder[0],
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'grade' },
      data: { status: 'PUBLISHED', publishedAt: expect.any(Date) as unknown },
    });
    expect(family).toHaveBeenCalledTimes(1);
  });
});
