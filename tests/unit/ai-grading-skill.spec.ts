import { validateEnvironment } from '../../src/config/configuration';
import {
  buildGradingSkillPayload,
  LESSON_CONTENT_MAX_CHARS,
} from '../../src/modules/academic/ai-grading-skill';

describe('AI Grading Skill & Configuration', () => {
  describe('buildGradingSkillPayload', () => {
    it('packages curriculum lesson, questions with rubric and student answers', () => {
      const payload = buildGradingSkillPayload({
        assignment: {
          id: 'assign-1',
          title: 'Bài tập Đại số',
          instructions: 'Làm đầy đủ các bước',
          kind: 'HOMEWORK',
          testType: null,
          program: { name: 'Toán 8', subject: 'Toán', grade: 8 },
          sessionLesson: {
            id: 'lesson-1',
            sequence: 1,
            title: 'Phương trình bậc nhất',
            content: 'Nội dung bài học phương trình bậc nhất một ẩn.',
          },
        },
        questions: [
          {
            id: 'q1',
            kind: 'MULTIPLE_CHOICE',
            prompt: 'Khai triển (x + 2)(x + 3)',
            choices: ['x² + 5x + 6', 'x² + 6'],
            correctAnswer: 'x² + 5x + 6',
            rubric: null,
            maxScore: 4,
          },
          {
            id: 'q2',
            kind: 'ESSAY',
            prompt: 'Giải phương trình 3x - 7 = 8',
            choices: undefined,
            correctAnswer: 'x = 5',
            rubric: 'Chuyển vế: 2đ, tìm nghiệm: 3đ, thử lại: 1đ',
            maxScore: 6,
            outcome: {
              code: 'EQ-01',
              title: 'Giải phương trình',
              statement: 'Giải được phương trình bậc nhất một ẩn',
            },
          },
        ],
        answers: [
          { questionId: 'q1', answer: 'x² + 5x + 6' },
          { questionId: 'q2', answer: '3x = 15 nên x = 5' },
        ],
      });

      expect(payload.curriculum.program).toEqual({
        name: 'Toán 8',
        subject: 'Toán',
        grade: 8,
      });
      expect(payload.curriculum.sessionLesson?.title).toBe('Phương trình bậc nhất');
      expect(payload.questions[0].maxScore).toBe(4);
      expect(payload.questions[1].rubric).toContain('Chuyển vế: 2đ');
      expect(payload.questions[1].learningOutcome?.code).toBe('EQ-01');
      expect(payload.answers).toHaveLength(2);
    });

    it('truncates lesson content exceeding maximum character limit', () => {
      const longContent = 'A'.repeat(LESSON_CONTENT_MAX_CHARS + 500);
      const payload = buildGradingSkillPayload({
        assignment: {
          id: 'assign-2',
          title: 'Bài tập',
          instructions: '',
          kind: 'HOMEWORK',
          testType: null,
          sessionLesson: {
            id: 'l-long',
            sequence: 1,
            title: 'Bài dài',
            content: longContent,
          },
        },
        questions: [],
        answers: [],
      });

      expect(payload.curriculum.sessionLesson?.content.length).toBeLessThan(longContent.length);
      expect(payload.curriculum.sessionLesson?.content.endsWith('...')).toBe(true);
    });
  });

  describe('validateEnvironment DeepSeek defaults', () => {
    const baseEnv = {
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL: 'mysql://root@localhost:3306/test',
      CORS_ORIGINS: 'http://localhost:3000',
      JWT_ACCESS_SECRET: '12345678901234567890123456789012',
      JWT_REFRESH_SECRET: '12345678901234567890123456789012',
    };

    it('defaults aiUrl to DeepSeek chat completions and model to deepseek-chat when AI_API_KEY is provided', () => {
      const config = validateEnvironment({
        ...baseEnv,
        AI_API_KEY: 'sk-deepseek-test-key',
      });

      expect(config.academic.aiKey).toBe('sk-deepseek-test-key');
      expect(config.academic.aiUrl).toBe('https://api.deepseek.com/chat/completions');
      expect(config.academic.aiModel).toBe('deepseek-chat');
    });

    it('keeps aiKey empty and disables AI when AI_API_KEY is not provided', () => {
      const config = validateEnvironment({
        ...baseEnv,
      });

      expect(config.academic.aiKey).toBe('');
      expect(config.academic.aiUrl).toBe('');
      expect(config.academic.aiModel).toBe('');
    });
  });
});
