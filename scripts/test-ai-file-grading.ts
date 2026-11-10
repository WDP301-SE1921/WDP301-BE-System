import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '../src/config/configuration';
import { AcademicAiService, isRecord } from '../src/integrations/academic-ai.service';
import { SubmissionReaderService } from '../src/modules/academic/submission-reader.service';
import {
  buildGradingSkillPayload,
  GRADING_SKILL_INSTRUCTION,
} from '../src/modules/academic/ai-grading-skill';
import { criterionTotal } from '../src/modules/academic/rubric';
import { AppError } from '../src/common/errors/app.error';

// Live provider smoke test only. No database writes, uploads or grade publication.
async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath)
    throw new Error(
      'Usage: pnpm test:ai:file <path-to-pdf-jpg-png>. Work must answer: 2x + 3 = 11.',
    );
  const mimeType = (
    {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
    } as Record<string, string>
  )[extname(filePath).toLowerCase()];
  if (!mimeType) throw new Error('Only PDF, JPG and PNG are supported.');
  const absolutePath = resolve(filePath);
  const info = await stat(absolutePath);
  if (!info.isFile() || !info.size || info.size > 10 * 1024 * 1024)
    throw new Error('File must be 1 byte to 10 MB.');
  const ai = new AcademicAiService(new ConfigService(validateEnvironment(process.env)));
  if (!ai.visionAvailable() || !ai.available())
    throw new Error(
      'Configure AI_CHAT_URL / AI_API_KEY / AI_MODEL and AI_VISION_CHAT_URL / AI_VISION_API_KEY / AI_VISION_MODEL first.',
    );
  const buffer = await readFile(absolutePath);
  const criteria = [
    {
      id: 'method',
      title: 'Biến đổi phương trình',
      description:
        'Trừ 3 hai vế để được 2x = 8 (1.5 điểm), chia hai vế cho 2 (1.5 điểm). Chấp nhận cách tương đương.',
      maxScore: 3,
    },
    { id: 'result', title: 'Kết luận', description: 'Kết luận nghiệm x = 4.', maxScore: 1 },
  ];
  const question = {
    id: 'demo-q1',
    kind: 'ESSAY' as const,
    prompt: 'Giải phương trình 2x + 3 = 11, trình bày các bước.',
    criteria,
    rubric: null,
    correctAnswer: 'x = 4',
    maxScore: 4,
  };
  const reader = new SubmissionReaderService(ai, {
    readObject: () => Promise.resolve(buffer),
  } as never);
  const readings = await reader.read(
    [{ id: 'demo-file', storageKey: 'local-smoke-test', mimeType, size: info.size }],
    [question],
    [{ questionId: question.id, answer: '' }],
  );
  console.log(JSON.stringify({ readings }, null, 2));
  if (!readings[0]?.readable) throw new Error('Manual review required. No score was generated.');
  const result = await ai.json(
    GRADING_SKILL_INSTRUCTION,
    buildGradingSkillPayload({
      assignment: {
        id: 'demo',
        title: 'Demo phương trình',
        instructions: '',
        kind: 'HOMEWORK',
        testType: null,
      },
      questions: [question],
      answers: readings.map(({ questionId, answer }) => ({ questionId, answer })),
    }),
  );
  if (
    !isRecord(result) ||
    !Array.isArray(result.scores) ||
    result.scores.length !== 1 ||
    !isRecord(result.scores[0]) ||
    result.scores[0].questionId !== question.id
  )
    throw new Error('Invalid AI scores.');
  const score = criterionTotal(criteria, result.scores[0].criteria);
  console.log(
    JSON.stringify(
      { score, maxScore: 4, criteria: result.scores[0].criteria, published: false },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof AppError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : 'File grading smoke test failed',
  );
  process.exitCode = 1;
});
