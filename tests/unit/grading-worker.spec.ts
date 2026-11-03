import { GradingWorkerService } from '../../src/modules/academic/grading-worker.service';

interface Score {
  questionId: string;
  score: number;
  feedback: string;
}

interface Harness {
  worker: GradingWorkerService;
  aiCalls: () => number;
  askedQuestionIds: () => string[];
  saved: () => unknown;
}

describe('GradingWorkerService essays answered in files', () => {
  const multipleChoice = {
    id: 'mc',
    kind: 'MULTIPLE_CHOICE',
    prompt: '1 + 1',
    choices: ['2', '3'],
    rubric: null,
    correctAnswer: '2',
    maxScore: 4,
    outcome: null,
  };
  const essay = {
    id: 'essay',
    kind: 'ESSAY',
    prompt: 'Giải 3x = 15',
    rubric: 'Chuyển vế 3đ, tìm nghiệm 3đ',
    correctAnswer: 'x = 5',
    maxScore: 6,
    outcome: null,
  };
  const mcScore: Score = { questionId: 'mc', score: 4, feedback: 'Đúng' };

  function setup(input: { questions: object[]; essayAnswer: string; aiScores: Score[] }): Harness {
    const updateMany = jest.fn<Promise<{ count: number }>, [{ data: unknown }]>(() =>
      Promise.resolve({ count: 1 }),
    );
    const json = jest.fn<Promise<{ scores: Score[] }>, [string, { questions: { id: string }[] }]>(
      () => Promise.resolve({ scores: input.aiScores }),
    );
    const db = {
      gradingJob: {
        updateMany,
        findFirst: jest.fn().mockResolvedValue({ id: 'job-1', submissionId: 'sub-1' }),
      },
      submission: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'sub-1',
          files: [{ fileId: 'file-1' }],
          answers: [
            { questionId: 'mc', answer: '2' },
            { questionId: 'essay', answer: input.essayAnswer },
          ],
          recipient: {
            assignment: {
              id: 'a-1',
              title: 'Bài tập',
              instructions: '',
              kind: 'HOMEWORK',
              testType: null,
              class: null,
              session: null,
              questions: input.questions,
            },
          },
        }),
      },
      lesson: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const worker = new GradingWorkerService(
      { db } as unknown as never,
      {} as never,
      { available: () => true, json } as unknown as never,
    );
    return {
      worker,
      aiCalls: () => json.mock.calls.length,
      askedQuestionIds: () => (json.mock.calls[0]?.[1].questions ?? []).map(({ id }) => id),
      saved: () => updateMany.mock.calls.at(-1)?.[0].data,
    };
  }

  it('asks the AI only about readable answers and leaves the photo essay to the teacher', async () => {
    const { worker, askedQuestionIds, saved } = setup({
      questions: [multipleChoice, essay],
      essayAnswer: '',
      aiScores: [mcScore],
    });
    await worker.tick();
    expect(askedQuestionIds()).toEqual(['mc']);
    expect(saved()).toEqual({
      status: 'SUCCEEDED',
      result: { scores: [mcScore], manualReviewQuestionIds: ['essay'] },
    });
  });

  it('still grades a written essay when the submission also has files', async () => {
    const essayScore: Score = { questionId: 'essay', score: 6, feedback: 'Đủ các bước' };
    const { worker, askedQuestionIds, saved } = setup({
      questions: [multipleChoice, essay],
      essayAnswer: '3x = 15 nên x = 5',
      aiScores: [mcScore, essayScore],
    });
    await worker.tick();
    expect(askedQuestionIds()).toEqual(['mc', 'essay']);
    expect(saved()).toEqual({
      status: 'SUCCEEDED',
      result: { scores: [mcScore, essayScore], manualReviewQuestionIds: [] },
    });
  });

  it('skips the AI call when every question is answered in files', async () => {
    const { worker, aiCalls, saved } = setup({
      questions: [essay],
      essayAnswer: '',
      aiScores: [],
    });
    await worker.tick();
    expect(aiCalls()).toBe(0);
    expect(saved()).toEqual({
      status: 'SUCCEEDED',
      result: { scores: [], manualReviewQuestionIds: ['essay'] },
    });
  });
});
