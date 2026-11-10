import { ConfigService } from '@nestjs/config';
import { AcademicAiService } from '../../src/integrations/academic-ai.service';
import { SubmissionReaderService } from '../../src/modules/academic/submission-reader.service';
import { GradingWorkerService } from '../../src/modules/academic/grading-worker.service';

describe('image bytes → vision transcript → rubric score', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each([false, true])(
    'connects both services and preserves evidence (rate limited: %s)',
    async (rateLimited) => {
      const response = (data: unknown): Response =>
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }],
          }),
        );
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          response({
            answers: [
              {
                questionId: 'q',
                answer: '2x = 8; x = 4',
                readable: true,
                sources: [{ fileId: 'photo', page: 1 }],
                reason: '',
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          rateLimited
            ? new Response('', { status: 429 })
            : response({
                scores: [
                  {
                    questionId: 'q',
                    score: 99,
                    feedback: 'Đúng kết quả, thiếu bước',
                    criteria: [
                      { criterionId: 'method', score: 2, feedback: 'Thiếu bước' },
                      { criterionId: 'result', score: 1, feedback: 'Đúng' },
                    ],
                  },
                ],
              }),
        );
      const ai = new AcademicAiService(
        new ConfigService({
          academic: {
            aiUrl: 'https://text.example.test',
            aiKey: 'text',
            aiModel: 'text-model',
            visionUrl: 'https://vision.example.test',
            visionKey: 'vision',
            visionModel: 'vision-model',
          },
        }) as never,
      );
      const reader = new SubmissionReaderService(ai, {
        readObject: jest.fn().mockResolvedValue(Buffer.from('image-bytes')),
      } as never);
      const records: { status: string; result?: unknown; error?: string }[] = [];
      const updateMany = jest
        .fn()
        .mockImplementation(({ data }: { data: (typeof records)[number] }) => {
          records.push(data);
          return Promise.resolve({ count: 1 });
        });
      const repo = {
        db: {
          gradingJob: {
            updateMany,
            findFirst: jest.fn().mockResolvedValue({ id: 'job', submissionId: 's' }),
          },
          submission: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({
              answers: [{ questionId: 'q', answer: '', fileIds: ['photo'] }],
              files: [
                {
                  file: {
                    id: 'photo',
                    storageKey: 'private/photo',
                    mimeType: 'image/jpeg',
                    size: 11,
                  },
                },
              ],
              recipient: {
                assignment: {
                  id: 'a',
                  title: 'Phương trình',
                  instructions: '',
                  kind: 'HOMEWORK',
                  testType: null,
                  class: null,
                  session: null,
                  questions: [
                    {
                      id: 'q',
                      kind: 'ESSAY',
                      prompt: '2x + 3 = 11',
                      correctAnswer: 'x = 4',
                      rubric: 'Phương pháp 3, kết quả 1',
                      maxScore: 4,
                      criteria: [
                        { id: 'method', title: 'Phương pháp', description: '', maxScore: 3 },
                        { id: 'result', title: 'Kết quả', description: '', maxScore: 1 },
                      ],
                    },
                  ],
                },
              },
            }),
          },
        },
      };
      await new GradingWorkerService(repo as never, {} as never, ai, reader).tick();
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        'https://vision.example.test',
        'https://text.example.test',
      ]);
      expect(JSON.stringify(JSON.parse(fetchMock.mock.calls[0][1]?.body as string))).not.toContain(
        'correctAnswer',
      );
      expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({
        messages: [
          { role: 'system' },
          { role: 'user', content: expect.stringContaining('2x = 8; x = 4') as unknown },
        ],
      });
      expect(records.at(-2)).toMatchObject({
        result: {
          readings: [{ answer: '2x = 8; x = 4', sources: [{ fileId: 'photo', page: 1 }] }],
        },
      });
      expect(records.at(-1)).toMatchObject(
        rateLimited
          ? {
              status: 'FAILED',
              error: expect.stringMatching(/^AI_PROVIDER_RATE_LIMITED:/) as unknown,
            }
          : {
              status: 'SUCCEEDED',
              result: { scores: [{ questionId: 'q', score: 3 }], manualReviewQuestionIds: [] },
            },
      );
    },
  );
});
