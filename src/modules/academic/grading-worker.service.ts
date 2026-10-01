import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AcademicAiService, isRecord } from '../../integrations/academic-ai.service';
import { AcademicRepository } from './academic.repository';
import { AssessmentService, validateScores } from './assessment.service';
import { assertRule } from './academic-access.service';

@Injectable()
export class GradingWorkerService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private readonly logger = new Logger(GradingWorkerService.name);
  constructor(
    private readonly repo: AcademicRepository,
    private readonly assessment: AssessmentService,
    private readonly ai: AcademicAiService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      if (!this.running && this.ai.available()) {
        this.running = this.tick()
          .catch(() => {
            this.logger.warn('Grading worker iteration failed');
          })
          .finally(() => {
            this.running = undefined;
          });
      }
    }, 2000);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  async enqueue(user: AuthenticatedUser, submissionId: string): Promise<unknown> {
    const submission = await this.repo.db.submission.findUniqueOrThrow({
      where: { id: submissionId },
      include: { recipient: true, files: true },
    });
    await this.assessment.teacher(user, submission.recipient.assignmentId);
    if (!this.ai.available())
      throw new ServiceUnavailableException(
        'AI is not configured; manual grading remains available',
      );
    assertRule(
      !submission.files.length,
      'AI_ATTACHMENTS_UNSUPPORTED',
      'Attached files require manual review; AI currently grades text answers only',
    );
    return this.repo.transaction(async (tx) => {
      const pending = await tx.gradingJob.findFirst({
        where: { submissionId, status: { in: ['QUEUED', 'PROCESSING'] } },
      });
      return pending ?? tx.gradingJob.create({ data: { submissionId } });
    });
  }

  async result(user: AuthenticatedUser, id: string): Promise<unknown> {
    const job = await this.repo.db.gradingJob.findUniqueOrThrow({
      where: { id },
      include: { submission: { include: { recipient: true } } },
    });
    await this.assessment.teacher(user, job.submission.recipient.assignmentId);
    return {
      id: job.id,
      submissionId: job.submissionId,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
    };
  }

  async tick(): Promise<void> {
    await this.repo.db.gradingJob.updateMany({
      where: { status: 'PROCESSING', startedAt: { lt: new Date(Date.now() - 120000) } },
      data: { status: 'FAILED', error: 'Processing interrupted; request a new grading run' },
    });
    const job = await this.repo.db.gradingJob.findFirst({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
    });
    if (!job) return;
    const claim = await this.repo.db.gradingJob.updateMany({
      where: { id: job.id, status: 'QUEUED' },
      data: { status: 'PROCESSING', startedAt: new Date() },
    });
    if (!claim.count) return;
    try {
      const submission = await this.repo.db.submission.findUniqueOrThrow({
        where: { id: job.submissionId },
        include: { recipient: { include: { assignment: { include: { questions: true } } } } },
      });
      const questions = submission.recipient.assignment.questions;
      const response = await this.ai.json(
        'Suggest grades. Shape: {"scores":[{"questionId":"id","score":0,"feedback":"reason"}]}. Use the supplied rubric and maximum score. Do not publish results.',
        {
          questions: questions.map((q) => ({
            id: q.id,
            prompt: q.prompt,
            rubric: q.rubric,
            correctAnswer: q.correctAnswer,
            maxScore: q.maxScore,
          })),
          answers: submission.answers,
        },
      );
      assertRule(
        isRecord(response) && Array.isArray(response.scores),
        'INVALID_AI_RESULT',
        'Missing scores',
      );
      const scores = response.scores.map((value: unknown) => {
        assertRule(
          isRecord(value) &&
            typeof value.questionId === 'string' &&
            typeof value.score === 'number' &&
            typeof value.feedback === 'string' &&
            value.feedback.length <= 5000,
          'INVALID_AI_RESULT',
          'Invalid score format',
        );
        return { questionId: value.questionId, score: value.score, feedback: value.feedback };
      });
      validateScores(questions, scores);
      await this.repo.db.gradingJob.updateMany({
        where: { id: job.id, status: 'PROCESSING' },
        data: { status: 'SUCCEEDED', result: { scores } },
      });
    } catch {
      await this.repo.db.gradingJob.updateMany({
        where: { id: job.id, status: 'PROCESSING' },
        data: {
          status: 'FAILED',
          error: 'AI grading failed or returned invalid data. Retry or grade manually.',
        },
      });
    }
  }
}
