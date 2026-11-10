import { SubmissionReaderService, ReadAnswer } from './submission-reader.service';
import { rubricCriteria, criterionTotal } from './rubric';
import { AppError } from '../../common/errors/app.error';
import { AiGradingRequestDto } from './academic.dto';
import {
  Injectable,
  Optional,
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
  essaysAnsweredInFiles,
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
    @Optional() private readonly reader?: SubmissionReaderService,
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

  async enqueue(
    user: AuthenticatedUser,
    submissionId: string,
    input: AiGradingRequestDto = {},
  ): Promise<unknown> {
    const submission = await this.repo.db.submission.findUniqueOrThrow({
      where: { id: submissionId },
      include: { recipient: true, files: true },
    });
    await this.assessment.teacher(user, submission.recipient.assignmentId);
    let corrections = input.corrections ?? [];
    if (corrections.length) {
      const questions = await this.repo.db.assignmentQuestion.findMany({
        where: { assignmentId: submission.recipient.assignmentId },
        select: { id: true },
      });
      assertRule(
        new Set(corrections.map((c) => c.questionId)).size === corrections.length &&
          corrections.every((c) => c.answer.trim() && questions.some((q) => q.id === c.questionId)),
        'INVALID_AI_CORRECTIONS',
        'Corrections must reference distinct questions in this assignment',
      );
    }
    if (!this.ai.available())
      throw new ServiceUnavailableException(
        'AI is not configured; manual grading remains available',
      );
    return this.repo.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM submissions WHERE id = ${submissionId} FOR UPDATE`;
      const pending = await tx.gradingJob.findFirst({
        where: { submissionId, status: { in: ['QUEUED', 'PROCESSING'] } },
      });
      assertRule(
        !pending || !corrections.length,
        'AI_JOB_BUSY',
        'Wait for the current run before submitting corrections',
      );
      if (corrections.length) {
        const previous = await tx.gradingJob.findFirst({
          where: { submissionId, status: 'SUCCEEDED' },
          orderBy: { createdAt: 'desc' },
        });
        const prior =
          previous && isRecord(previous.result) && Array.isArray(previous.result.corrections)
            ? previous.result.corrections
            : [];
        const merged = new Map<string, { questionId: string; answer: string }>();
        for (const c of prior)
          if (isRecord(c) && typeof c.questionId === 'string' && typeof c.answer === 'string')
            merged.set(c.questionId, { questionId: c.questionId, answer: c.answer });
        for (const c of corrections) merged.set(c.questionId, c);
        corrections = [...merged.values()];
      }
      return (
        pending ??
        tx.gradingJob.create({
          data: {
            submissionId,
            ...(corrections.length
              ? {
                  result: {
                    corrections: corrections.map((c) => ({
                      questionId: c.questionId,
                      answer: c.answer,
                    })),
                    correctedById: user.id,
                  },
                }
              : {}),
          },
        })
      );
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
      errorCode: job.error?.match(/^([A-Z][A-Z0-9_]+): /)?.[1] ?? null,
      createdAt: job.createdAt,
    };
  }

  async tick(): Promise<void> {
    await this.repo.db.gradingJob.updateMany({
      where: { status: 'PROCESSING', startedAt: { lt: new Date(Date.now() - 600000) } },
      data: { status: 'FAILED', error: 'AI_JOB_INTERRUPTED: Request a new grading run' },
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
          files: { include: { file: true } },
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
      let answers = submission.answers;
      let readings: ReadAnswer[] = [];
      let readingError: string | undefined;
      const manualReview = essaysAnsweredInFiles(
        assignment.questions,
        answers,
        submission.files.length > 0,
      );
      if (submission.files.length && this.reader) {
        try {
          readings = await this.reader.read(
            submission.files.map((f) => f.file),
            assignment.questions,
            answers,
          );
          manualReview.clear();
          for (const row of readings) if (!row.readable) manualReview.add(row.questionId);
          answers = readings.map((row) => ({ questionId: row.questionId, answer: row.answer }));
        } catch (error) {
          readingError = error instanceof AppError ? error.code : 'AI_READING_FAILED';
          for (const q of assignment.questions)
            if (
              q.kind === 'ESSAY' ||
              !Array.isArray(answers) ||
              !answers.some(
                (a) =>
                  isRecord(a) &&
                  a.questionId === q.id &&
                  typeof a.answer === 'string' &&
                  a.answer.trim(),
              )
            )
              manualReview.add(q.id);
        }
      }
      const corrections =
        isRecord(job.result) && Array.isArray(job.result.corrections) ? job.result.corrections : [];
      for (const c of corrections) {
        if (
          !isRecord(c) ||
          typeof c.questionId !== 'string' ||
          typeof c.answer !== 'string' ||
          !assignment.questions.some((q) => q.id === c.questionId)
        )
          continue;
        const row = {
          questionId: c.questionId,
          answer: c.answer,
          readable: true,
          sources: [],
          reason: 'Nội dung đã được giáo viên kiểm tra.',
        };
        readings = [...readings.filter((r) => r.questionId !== c.questionId), row];
        answers = [
          ...(Array.isArray(answers)
            ? answers.filter((a) => !isRecord(a) || a.questionId !== c.questionId)
            : []),
          { questionId: c.questionId, answer: c.answer },
        ];
        manualReview.delete(c.questionId);
      }
      const readingResult =
        this.reader && submission.files.length
          ? {
              readings: readings.map((r) => ({
                ...r,
                sources: r.sources.map((source) => ({ ...source })),
              })),
              readingError: readingError ?? null,
              corrections,
              correctedById:
                isRecord(job.result) && typeof job.result.correctedById === 'string'
                  ? job.result.correctedById
                  : null,
            }
          : {};
      const questions = assignment.questions.filter((question) => !manualReview.has(question.id));
      const manualReviewQuestionIds = [...manualReview];
      if (!questions.length) {
        await this.repo.db.gradingJob.updateMany({
          where: { id: job.id, status: 'PROCESSING' },
          data: {
            status: 'SUCCEEDED',
            result: { scores: [], manualReviewQuestionIds, ...readingResult },
          },
        });
        return;
      }
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
      if (this.reader && submission.files.length) {
        await this.repo.db.gradingJob.updateMany({
          where: { id: job.id, status: 'PROCESSING' },
          data: { result: { scores: [], manualReviewQuestionIds, ...readingResult } },
        });
      }
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
          answers,
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
        const question = questions.find((q) => q.id === value.questionId);
        assertRule(question, 'INVALID_AI_RESULT', 'Unknown question');
        const criteria = rubricCriteria(question.criteria);
        const score = criteria.length ? criterionTotal(criteria, value.criteria) : value.score;
        const objectiveScore =
          question.kind === 'MULTIPLE_CHOICE'
            ? Array.isArray(answers) &&
              answers.some(
                (a) =>
                  isRecord(a) &&
                  a.questionId === question.id &&
                  a.answer === question.correctAnswer,
              )
              ? question.maxScore
              : 0
            : score;
        return {
          questionId: value.questionId,
          score: objectiveScore,
          feedback: value.feedback,
          ...(criteria.length
            ? {
                criteria: value.criteria as {
                  criterionId: string;
                  score: number;
                  feedback: string;
                }[],
              }
            : {}),
        };
      });
      validateScores(questions, scores);
      await this.repo.db.gradingJob.updateMany({
        where: { id: job.id, status: 'PROCESSING' },
        data: {
          status: 'SUCCEEDED',
          result: {
            scores,
            manualReviewQuestionIds,
            ...readingResult,
            ...(this.reader
              ? {
                  rubricSnapshot: questions.map((q) => ({
                    id: q.id,
                    criteria: q.criteria,
                    rubric: q.rubric,
                    maxScore: q.maxScore,
                  })),
                }
              : {}),
          },
        },
      });
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'AI_GRADING_FAILED';
      await this.repo.db.gradingJob.updateMany({
        where: { id: job.id, status: 'PROCESSING' },
        data: {
          status: 'FAILED',
          error: `${code}: AI grading failed. Retry or grade manually.`,
        },
      });
    }
  }
}
