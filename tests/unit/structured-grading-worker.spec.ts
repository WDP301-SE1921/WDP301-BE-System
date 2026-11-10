import { GradingWorkerService } from '../../src/modules/academic/grading-worker.service';
import { AppError } from '../../src/common/errors/app.error';

describe('file reading to rubric scoring', () => {
  const criteria = [
    { id: 'method', title: 'Phương pháp', description: '', maxScore: 3 },
    { id: 'result', title: 'Kết quả', description: '', maxScore: 1 },
  ];
  function setup(
    input: {
      unreadable?: boolean;
      readingFails?: boolean;
      invalidScores?: boolean;
      correction?: boolean;
    } = {},
  ): {
    worker: GradingWorkerService;
    json: jest.Mock<Promise<unknown>, [string, unknown]>;
    saved: () => unknown;
  } {
    const updateMany = jest
      .fn<Promise<{ count: number }>, [{ data: unknown }]>()
      .mockResolvedValue({ count: 1 });
    const read = jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue([
      {
        questionId: 'q',
        answer: 'x = 4',
        readable: !input.unreadable,
        reason: input.unreadable ? 'Ảnh mờ' : '',
        sources: [{ fileId: 'file', page: 1 }],
      },
    ]);
    if (input.readingFails)
      read.mockRejectedValue(new AppError('AI_VISION_UNAVAILABLE', 'No vision'));
    const json = jest.fn<Promise<unknown>, [string, unknown]>().mockResolvedValue({
      scores: [
        {
          questionId: 'q',
          score: 99,
          feedback: 'Đúng một phần',
          criteria: [
            { criterionId: 'method', score: input.invalidScores ? 4 : 2, feedback: 'Thiếu bước' },
            { criterionId: 'result', score: 1, feedback: 'Đúng' },
          ],
        },
      ],
    });
    const repo = {
      db: {
        gradingJob: {
          updateMany,
          findFirst: jest.fn().mockResolvedValue({
            id: 'job',
            submissionId: 'submission',
            result: input.correction
              ? {
                  correctedById: 'teacher',
                  corrections: [{ questionId: 'q', answer: 'Nội dung giáo viên đã kiểm tra' }],
                }
              : null,
          }),
        },
        submission: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            answers: [{ questionId: 'q', answer: '' }],
            files: [
              { file: { id: 'file', mimeType: 'image/png', size: 20, storageKey: 'private' } },
            ],
            recipient: {
              assignment: {
                id: 'assignment',
                title: 'Bài kiểm tra',
                instructions: '',
                kind: 'TEST',
                testType: 'MIDTERM',
                class: null,
                session: null,
                questions: [
                  {
                    id: 'q',
                    kind: 'ESSAY',
                    prompt: 'Giải',
                    maxScore: 4,
                    rubric: null,
                    criteria,
                    correctAnswer: null,
                  },
                ],
              },
            },
          }),
        },
      },
    };
    const worker = new GradingWorkerService(
      repo as never,
      {} as never,
      { json, available: () => true } as never,
      { read } as never,
    );
    return { worker, json, saved: (): unknown => updateMany.mock.calls.at(-1)?.[0].data };
  }
  it('reads file-only work and derives the score from individual criteria', async () => {
    const h = setup();
    await h.worker.tick();
    expect(h.saved()).toMatchObject({
      status: 'SUCCEEDED',
      result: {
        scores: [{ questionId: 'q', score: 3 }],
        manualReviewQuestionIds: [],
        readings: [{ answer: 'x = 4', sources: [{ fileId: 'file', page: 1 }] }],
      },
    });
  });
  it.each([{ unreadable: true }, { readingFails: true }])(
    'does not invent zero for unreadable/failed files: %j',
    async (input) => {
      const h = setup(input);
      await h.worker.tick();
      expect(h.json).not.toHaveBeenCalled();
      expect(h.saved()).toMatchObject({
        status: 'SUCCEEDED',
        result: { scores: [], manualReviewQuestionIds: ['q'] },
      });
    },
  );
  it('rejects out-of-range AI criterion scores instead of clamping or publishing', async () => {
    const h = setup({ invalidScores: true });
    await h.worker.tick();
    expect(h.saved()).toMatchObject({ status: 'FAILED' });
  });
  it('uses teacher-verified corrections when image reading is unavailable', async () => {
    const h = setup({ readingFails: true, correction: true });
    await h.worker.tick();
    expect(h.json.mock.calls[0][1]).toMatchObject({
      answers: [{ questionId: 'q', answer: 'Nội dung giáo viên đã kiểm tra' }],
    });
    expect(h.saved()).toMatchObject({
      status: 'SUCCEEDED',
      result: { manualReviewQuestionIds: [], correctedById: 'teacher' },
    });
  });
});
