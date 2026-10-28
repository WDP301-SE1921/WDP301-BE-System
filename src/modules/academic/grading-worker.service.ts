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
import {
  buildGradingSkillPayload,
  GRADING_SKILL_INSTRUCTION,
  MAX_PROGRAM_LESSONS_CONTEXT,
} from './ai-grading-skill';

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
        include: {
          files: true,
          recipient: {
            include: {
              assignment: {
                include: {
                  class: { include: { program: true } },
                  session: { include: { lesson: true } },
                  questions: {
                    orderBy: { position: 'asc' },
                    include: { outcome: true },
                  },
                },
              },
            },
          },
        },
      });
      const assignment = submission.recipient.assignment;
      const questions = assignment.questions;
      const programLessons =
        !assignment.session?.lesson && assignment.class?.programId
          ? await this.repo.db.lesson.findMany({
              where: {
                programId: assignment.class.programId,
                status: 'APPROVED',
              },
              orderBy: { sequence: 'asc' },
              take: MAX_PROGRAM_LESSONS_CONTEXT,
              select: { id: true, title: true, sequence: true, content: true },
            })
          : [];
      const response = await this.ai.json(
        GRADING_SKILL_INSTRUCTION,
        buildGradingSkillPayload({
          assignment: {
            id: assignment.id,
            title: assignment.title,
            instructions: assignment.instructions,
            kind: assignment.kind,
            testType: assignment.testType,
            program: assignment.class?.program ?? null,
            sessionLesson: assignment.session?.lesson ?? null,
          },
          programLessons,
          questions,
          answers: submission.answers,
          hasAttachments: Boolean(submission.files?.length),
        }),
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
