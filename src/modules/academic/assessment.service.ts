import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { assignedTeacherWhere } from '../registration-flow/class-teacher';
import { AcademicAccessService, assertRule, inTerm, roles } from './academic-access.service';
import { AcademicRepository } from './academic.repository';
import {
  AssignmentDto,
  GradeDto,
  PageDto,
  RecipientsDto,
  SubmissionDto,
  SubmissionWindowDto,
} from './academic.dto';

@Injectable()
export class AssessmentService {
  constructor(
    private readonly repo: AcademicRepository,
    private readonly access: AcademicAccessService,
  ) {}

  async create(user: AuthenticatedUser, input: AssignmentDto): Promise<unknown> {
    roles(user, 'TEACHER');
    await this.access.classroom(user, input.classId);
    this.validateDefinition(input);
    const { questions, dueAt, ...data } = input;
    return this.repo.db.assignment.create({
      data: {
        ...data,
        teacherId: user.id,
        dueAt: new Date(dueAt),
        questions: {
          create: questions.map((q, position) => ({
            ...q,
            choices: q.choices ?? Prisma.JsonNull,
            position,
          })),
        },
      },
      include: { questions: true },
    });
  }

  async updateDraft(user: AuthenticatedUser, id: string, input: AssignmentDto): Promise<unknown> {
    this.validateDefinition(input);
    return this.repo.transaction(async (tx) => {
      const assignment = await this.teacher(user, id, tx);
      assertRule(
        assignment.status === 'DRAFT' && assignment.classId === input.classId,
        'ASSIGNMENT_LOCKED',
        'Only a draft in the same class can be edited',
      );
      await tx.assignmentQuestion.deleteMany({ where: { assignmentId: id } });
      const { questions, dueAt, ...data } = input;
      return tx.assignment.update({
        where: { id },
        data: {
          ...data,
          dueAt: new Date(dueAt),
          questions: {
            create: questions.map((q, position) => ({
              ...q,
              choices: q.choices ?? Prisma.JsonNull,
              position,
            })),
          },
        },
        include: { questions: true },
      });
    });
  }

  private validateDefinition(input: AssignmentDto): void {
    assertRule(
      new Date(input.dueAt) > new Date(),
      'INVALID_DUE_DATE',
      'Due date must be in the future',
    );
    for (const question of input.questions) {
      if (question.kind === 'MULTIPLE_CHOICE')
        assertRule(
          question.choices?.includes(question.correctAnswer ?? ''),
          'INVALID_ANSWER_KEY',
          'Choice questions require a correct answer contained in choices',
        );
      else
        assertRule(
          question.rubric?.trim(),
          'RUBRIC_REQUIRED',
          'Essay questions require a grading rubric',
        );
    }
  }

  async list(user: AuthenticatedUser, page: PageDto): Promise<unknown> {
    roles(user, 'TEACHER', 'PARENT');
    const where: Prisma.AssignmentWhereInput =
      user.role === 'TEACHER'
        ? { class: assignedTeacherWhere(user.id, new Date()) }
        : {
            status: { not: 'DRAFT' },
            recipients: {
              some: {
                enrollment: {
                  status: { not: 'PENDING_LINK' },
                  studentProfile: { parentProfile: { userId: user.id } },
                },
              },
            },
          };
    return this.repo.db.assignment.findMany({
      where,
      select: {
        id: true,
        classId: true,
        title: true,
        dueAt: true,
        status: true,
        maxAttempts: true,
      },
      skip: (page.page - 1) * page.limit,
      take: page.limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async detail(user: AuthenticatedUser, id: string): Promise<unknown> {
    roles(user, 'TEACHER', 'PARENT');
    const assignment = await this.repo.db.assignment.findUniqueOrThrow({
      where: { id },
      include: {
        questions: { orderBy: { position: 'asc' } },
        recipients: {
          where:
            user.role === 'PARENT'
              ? {
                  enrollment: {
                    studentProfile: { parentProfile: { userId: user.id } },
                    status: { not: 'PENDING_LINK' },
                  },
                }
              : {},
          select: { id: true, enrollmentId: true },
        },
      },
    });
    if (user.role === 'TEACHER') await this.teacher(user, id);
    else
      assertRule(
        assignment.status !== 'DRAFT' && assignment.recipients.length,
        'FORBIDDEN',
        'Assignment is not available to this parent',
        HttpStatus.FORBIDDEN,
      );
    const showAnswers = user.role === 'TEACHER' || !!assignment.answersPublishedAt;
    return {
      id: assignment.id,
      classId: assignment.classId,
      title: assignment.title,
      instructions: assignment.instructions,
      dueAt: assignment.dueAt,
      status: assignment.status,
      maxAttempts: assignment.maxAttempts,
      recipients: assignment.recipients,
      questions: assignment.questions.map((q) => ({
        id: q.id,
        kind: q.kind,
        prompt: q.prompt,
        choices: q.choices,
        maxScore: q.maxScore,
        ...(showAnswers ? { correctAnswer: q.correctAnswer } : {}),
        ...(user.role === 'TEACHER' ? { rubric: q.rubric } : {}),
      })),
    };
  }

  async publish(user: AuthenticatedUser, id: string, input: RecipientsDto): Promise<unknown> {
    return this.repo.transaction(async (tx) => {
      const assignment = await this.teacher(user, id, tx);
      assertRule(
        assignment.status === 'DRAFT' && assignment.dueAt > new Date(),
        'ASSIGNMENT_LOCKED',
        'Only an unexpired draft can be published',
      );
      const enrollments = await tx.enrollment.findMany({
        where: { id: { in: input.enrollmentIds } },
        include: { placements: true },
      });
      assertRule(
        enrollments.length === input.enrollmentIds.length &&
          new Set(enrollments.map((e) => e.studentProfileId)).size === enrollments.length,
        'INVALID_RECIPIENTS',
        'Recipients must exist and refer to distinct students',
      );
      const now = new Date();
      for (const enrollment of enrollments) {
        assertRule(
          enrollment.studentProfileId && inTerm(enrollment, now),
          'INVALID_RECIPIENTS',
          'Only linked, currently enrolled students can receive work',
        );
        const placement = enrollment.placements.find(
          (p) => p.effectiveFrom <= now && (!p.effectiveTo || p.effectiveTo > now),
        );
        assertRule(
          (placement?.classId ?? enrollment.classId) === assignment.classId,
          'INVALID_RECIPIENTS',
          'Enrollment belongs to another class',
        );
      }
      await tx.assignmentRecipient.createMany({
        data: input.enrollmentIds.map((enrollmentId) => ({ assignmentId: id, enrollmentId })),
      });
      return tx.assignment.update({ where: { id }, data: { status: 'PUBLISHED' } });
    });
  }

  async close(user: AuthenticatedUser, id: string): Promise<unknown> {
    await this.teacher(user, id);
    const result = await this.repo.db.assignment.updateMany({
      where: { id, status: 'PUBLISHED' },
      data: { status: 'CLOSED' },
    });
    assertRule(result.count, 'INVALID_ASSIGNMENT_STATE', 'Assignment must be published');
    return { id, status: 'CLOSED' };
  }

  async reopen(user: AuthenticatedUser, id: string, input: SubmissionWindowDto): Promise<unknown> {
    return this.repo.transaction(async (tx) => {
      const assignment = await this.teacher(user, id, tx);
      assertRule(
        assignment.status !== 'DRAFT' && !assignment.answersPublishedAt,
        'ANSWERS_ALREADY_VISIBLE',
        'Cannot reopen a draft or an assignment with published answers',
      );
      assertRule(
        new Date(input.dueAt) > new Date() && input.maxAttempts >= assignment.maxAttempts,
        'INVALID_SUBMISSION_WINDOW',
        'Extend the future deadline without reducing allowed attempts',
      );
      return tx.assignment.update({
        where: { id },
        data: { dueAt: new Date(input.dueAt), maxAttempts: input.maxAttempts, status: 'PUBLISHED' },
      });
    });
  }

  async publishAnswers(user: AuthenticatedUser, id: string): Promise<unknown> {
    return this.repo.transaction(async (tx) => {
      const assignment = await this.teacher(user, id, tx);
      assertRule(
        assignment.status === 'CLOSED',
        'ASSIGNMENT_NOT_CLOSED',
        'Close submissions before publishing answers',
      );
      return tx.assignment.update({ where: { id }, data: { answersPublishedAt: new Date() } });
    });
  }

  async submit(user: AuthenticatedUser, input: SubmissionDto): Promise<unknown> {
    roles(user, 'PARENT');
    return this.repo.transaction(async (tx) => {
      const recipient = await tx.assignmentRecipient.findUniqueOrThrow({
        where: { id: input.recipientId },
        include: { enrollment: true, assignment: { include: { questions: true } } },
      });
      await this.access.enrollment(user, recipient.enrollmentId, tx);
      const assignment = recipient.assignment;
      assertRule(
        assignment.status === 'PUBLISHED' &&
          assignment.dueAt >= new Date() &&
          inTerm(recipient.enrollment, new Date()),
        'SUBMISSION_CLOSED',
        'Submission window or enrollment is closed',
      );
      const attempts = await tx.submission.count({ where: { recipientId: recipient.id } });
      assertRule(
        attempts < assignment.maxAttempts,
        'ATTEMPTS_EXHAUSTED',
        'Maximum submission attempts reached',
      );
      const ids = new Set(input.answers.map((a) => a.questionId));
      assertRule(
        ids.size === input.answers.length &&
          ids.size === assignment.questions.length &&
          assignment.questions.every((q) => ids.has(q.id)),
        'INVALID_ANSWERS',
        'Provide exactly one answer for every question',
      );
      for (const question of assignment.questions) {
        const answer = input.answers.find((a) => a.questionId === question.id)!;
        if (question.kind === 'MULTIPLE_CHOICE')
          assertRule(
            Array.isArray(question.choices) && question.choices.includes(answer.answer),
            'INVALID_CHOICE',
            'Answer must match an available choice',
          );
      }
      const fileIds = input.fileIds ?? [];
      const files = await tx.fileAsset.count({ where: { id: { in: fileIds }, ownerId: user.id } });
      assertRule(
        files === fileIds.length,
        'INVALID_FILES',
        'Files must be uploaded by the submitting parent',
      );
      return tx.submission.create({
        data: {
          recipientId: recipient.id,
          attemptNo: attempts + 1,
          answers: input.answers.map((a) => ({ questionId: a.questionId, answer: a.answer })),
          files: { create: fileIds.map((fileId) => ({ fileId })) },
        },
        select: { id: true, recipientId: true, attemptNo: true, submittedAt: true },
      });
    });
  }

  async submissions(
    user: AuthenticatedUser,
    assignmentId: string,
    page: PageDto,
  ): Promise<unknown> {
    roles(user, 'TEACHER', 'PARENT');
    if (user.role === 'TEACHER') await this.teacher(user, assignmentId);
    return this.repo.db.submission.findMany({
      where: {
        recipient: {
          assignmentId,
          ...(user.role === 'PARENT'
            ? {
                enrollment: {
                  status: { not: 'PENDING_LINK' as const },
                  studentProfile: { parentProfile: { userId: user.id } },
                },
              }
            : {}),
        },
      },
      select: {
        id: true,
        recipientId: true,
        attemptNo: true,
        answers: true,
        submittedAt: true,
        files: { select: { fileId: true } },
        grades: {
          where: user.role === 'PARENT' ? { status: 'PUBLISHED' } : {},
          select: {
            id: true,
            revision: true,
            status: true,
            scores: true,
            totalScore: true,
            feedback: true,
            publishedAt: true,
          },
          orderBy: { revision: 'desc' },
        },
      },
      take: page.limit,
      skip: (page.page - 1) * page.limit,
      orderBy: { submittedAt: 'desc' },
    });
  }

  async grade(user: AuthenticatedUser, submissionId: string, input: GradeDto): Promise<unknown> {
    return this.repo.transaction(async (tx) => {
      const submission = await tx.submission.findUniqueOrThrow({
        where: { id: submissionId },
        include: { recipient: { include: { assignment: { include: { questions: true } } } } },
      });
      await this.teacher(user, submission.recipient.assignmentId, tx);
      validateScores(submission.recipient.assignment.questions, input.scores);
      const latest = await tx.gradeReview.findFirst({
        where: { submissionId },
        orderBy: { revision: 'desc' },
      });
      return tx.gradeReview.create({
        data: {
          submissionId,
          revision: (latest?.revision ?? 0) + 1,
          reviewerId: user.id,
          scores: input.scores.map((s) => ({ ...s })),
          totalScore: roundedTotal(input.scores),
          feedback: input.feedback,
        },
      });
    });
  }

  async objectiveGrade(user: AuthenticatedUser, id: string): Promise<unknown> {
    const submission = await this.repo.db.submission.findUniqueOrThrow({
      where: { id },
      include: { recipient: { include: { assignment: { include: { questions: true } } } } },
    });
    await this.teacher(user, submission.recipient.assignmentId);
    assertRule(
      submission.recipient.assignment.questions.every((q) => q.kind === 'MULTIPLE_CHOICE'),
      'ESSAY_REQUIRES_REVIEW',
      'Use manual or AI grading for essay questions',
    );
    const answers = submission.answers as unknown as { questionId: string; answer: string }[];
    return this.grade(user, id, {
      feedback: '',
      scores: submission.recipient.assignment.questions.map((q) => ({
        questionId: q.id,
        score:
          answers.find((a) => a.questionId === q.id)?.answer === q.correctAnswer ? q.maxScore : 0,
        feedback: '',
      })),
    });
  }

  async approveGrade(user: AuthenticatedUser, id: string): Promise<unknown> {
    return this.repo.transaction(async (tx) => {
      const grade = await tx.gradeReview.findUniqueOrThrow({
        where: { id },
        include: { submission: { include: { recipient: true } } },
      });
      await this.teacher(user, grade.submission.recipient.assignmentId, tx);
      assertRule(grade.status === 'DRAFT', 'INVALID_GRADE_STATE', 'Grade must be a draft');
      return tx.gradeReview.update({ where: { id }, data: { status: 'APPROVED' } });
    });
  }

  async publishGrade(user: AuthenticatedUser, id: string): Promise<unknown> {
    return this.repo.transaction(async (tx) => {
      const grade = await tx.gradeReview.findUniqueOrThrow({
        where: { id },
        include: { submission: { include: { recipient: true } } },
      });
      await this.teacher(user, grade.submission.recipient.assignmentId, tx);
      assertRule(
        grade.status === 'APPROVED',
        'GRADE_NOT_APPROVED',
        'Teacher approval is required before publication',
      );
      await tx.gradeReview.updateMany({
        where: { submission: { recipientId: grade.submission.recipientId }, status: 'PUBLISHED' },
        data: { status: 'SUPERSEDED' },
      });
      return tx.gradeReview.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
    });
  }

  async teacher(
    user: AuthenticatedUser,
    assignmentId: string,
    tx: Prisma.TransactionClient = this.repo.db,
  ): Promise<Prisma.AssignmentGetPayload<Record<string, never>>> {
    roles(user, 'TEACHER');
    const assignment = await tx.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    await this.access.classroom(user, assignment.classId, tx);
    return assignment;
  }
}

export function validateScores(
  questions: { id: string; maxScore: number }[],
  scores: { questionId: string; score: number }[],
): void {
  assertRule(
    scores.length === questions.length &&
      new Set(scores.map((s) => s.questionId)).size === scores.length,
    'INVALID_SCORES',
    'Exactly one score per question is required',
  );
  for (const question of questions) {
    const score = scores.find((s) => s.questionId === question.id)?.score;
    assertRule(
      score !== undefined && Number.isFinite(score) && score >= 0 && score <= question.maxScore,
      'INVALID_SCORES',
      'Score is outside the question range',
    );
  }
}
export function roundedTotal(scores: { score: number }[]): number {
  return Math.round(scores.reduce((sum, score) => sum + score.score, 0) * 100) / 100;
}
