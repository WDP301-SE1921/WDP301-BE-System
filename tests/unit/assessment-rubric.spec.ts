import type { GradeDto } from '../../src/modules/academic/academic.dto';
import type { AssignmentDto } from '../../src/modules/academic/academic.dto';
import { AssessmentService } from '../../src/modules/academic/assessment.service';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';

describe('teacher rubric grade persistence', () => {
  const criteria = [
    { id: 'method', title: 'Phương pháp', description: '', maxScore: 3 },
    { id: 'result', title: 'Kết quả', description: '', maxScore: 1 },
  ];
  const teacher = { id: 'teacher', role: 'TEACHER' } as AuthenticatedUser;
  function setup(revision: number): {
    service: AssessmentService;
    create: jest.Mock<Promise<{ id: string }>, [unknown]>;
  } {
    const create = jest.fn<Promise<{ id: string }>, [unknown]>().mockResolvedValue({ id: 'grade' });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      submission: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          recipient: {
            assignmentId: 'assignment',
            assignment: {
              questions: [{ id: 'q', maxScore: 4, criteria, rubric: null, outcomeId: 'clo' }],
            },
          },
        }),
      },
      assignment: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'assignment', classId: 'class' }),
      },
      gradeReview: {
        findFirst: jest.fn().mockResolvedValue(revision ? { revision } : null),
        create,
      },
    };
    const service = new AssessmentService(
      { transaction: (fn: (db: typeof tx) => Promise<unknown>) => fn(tx) } as never,
      { classroom: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    );
    return { service, create };
  }
  const input = (): GradeDto => ({
    expectedRevision: 0,
    feedback: '',
    scores: [
      {
        questionId: 'q',
        score: 99,
        feedback: '',
        criteria: [
          { criterionId: 'method', score: 2, feedback: 'Thiếu bước' },
          { criterionId: 'result', score: 1, feedback: 'Đúng' },
        ],
      },
    ],
  });
  it('computes totals on the server and stores the rubric and CLO snapshot', async () => {
    const h = setup(0);
    await h.service.grade(teacher, 'submission', input());
    expect(h.create.mock.calls[0][0]).toMatchObject({
      data: {
        totalScore: 3,
        revision: 1,
        scores: [{ score: 3 }],
        rubricSnapshot: [{ questionId: 'q', outcomeId: 'clo', criteria }],
      },
    });
  });
  it('rejects stale grade revisions instead of overwriting another save', async () => {
    const h = setup(1);
    await expect(h.service.grade(teacher, 'submission', input())).rejects.toMatchObject({
      code: 'GRADE_REVISION_CONFLICT',
    });
    expect(h.create).not.toHaveBeenCalled();
  });
  it('requires all criterion grades rather than trusting a question total', async () => {
    const h = setup(0);
    const value = input();
    value.scores[0].criteria?.pop();
    await expect(h.service.grade(teacher, 'submission', value)).rejects.toMatchObject({
      code: 'INVALID_CRITERION_SCORES',
    });
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe('retaining attachments after a teacher transfer', () => {
  const teacher = { id: 'new-teacher', role: 'TEACHER' } as AuthenticatedUser;
  const count = jest.fn<Promise<number>, [unknown]>();
  const update = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({ id: 'assignment' });
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    assignment: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'assignment', classId: 'class', status: 'DRAFT' }),
      update,
    },
    assignmentQuestion: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    fileAsset: { count },
  };
  const service = new AssessmentService(
    { transaction: (work: (db: typeof tx) => Promise<unknown>) => work(tx) } as never,
    { classroom: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
  );
  const input: AssignmentDto = {
    classId: 'class',
    title: 'Draft',
    instructions: '',
    dueAt: '2099-12-01T12:00:00Z',
    maxAttempts: 1,
    files: [{ fileId: 'existing-file', teacherOnly: true }],
    questions: [{ kind: 'ESSAY', prompt: 'Explain', maxScore: 4, rubric: 'Barem cũ' }],
  };
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('allows retained files through the current assignment relation, without requiring re-upload', async () => {
    count.mockResolvedValue(1);
    await service.updateDraft(teacher, 'assignment', input);
    expect(count).toHaveBeenCalledWith({
      where: {
        id: { in: ['existing-file'] },
        OR: [{ ownerId: 'new-teacher' }, { assignments: { some: { assignmentId: 'assignment' } } }],
      },
    });
    expect(update).toHaveBeenCalledTimes(1);
  });
  it('rejects a foreign file that is neither owned nor retained by the assignment', async () => {
    count.mockResolvedValue(0);
    await expect(service.updateDraft(teacher, 'assignment', input)).rejects.toMatchObject({
      code: 'INVALID_FILES',
    });
    expect(update).not.toHaveBeenCalled();
  });
});
