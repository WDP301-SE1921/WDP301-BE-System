import { randomUUID } from 'node:crypto';
import { NotificationEventsService } from '../notifications/notification-events.service';
import type { ParentGradesResponseDto } from './parent-learning-response.dto';
import { pageResult } from '../../common/pagination';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { assignedTeacherAt, assignedTeacherWhere } from '../registration-flow/class-teacher';
import { AcademicAccessService, assertRule, inTerm, roles } from './academic-access.service';
import { AcademicRepository } from './academic.repository';
import {
  AssignmentDto,
  StudentPageDto,
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
    private readonly notifications: NotificationEventsService,
  ) {}

  async create(user: AuthenticatedUser, input: AssignmentDto): Promise<unknown> {
    roles(user, 'TEACHER');
    await this.access.classroom(user, input.classId);
    this.validateDefinition(input);
    await this.validateSession(user, input);
    const { questions, dueAt, ...data } = input;
    return this.repo.db.assignment.create({
      data: {
        ...data,
        kind: input.kind ?? 'HOMEWORK',
        sessionId: input.sessionId ?? null,
        testType: input.testType ?? null,
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
      await this.validateSession(user, input, tx);
      await tx.assignmentQuestion.deleteMany({ where: { assignmentId: id } });
      const { questions, dueAt, ...data } = input;
      return tx.assignment.update({
        where: { id },
        data: {
          ...data,
          kind: input.kind ?? 'HOMEWORK',
          sessionId: input.sessionId ?? null,
          testType: input.testType ?? null,
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

  private async validateSession(
    user: AuthenticatedUser,
    input: { classId: string; kind?: string; sessionId?: string | null; testType?: string | null },
    tx: Prisma.TransactionClient = this.repo.db,
  ): Promise<void> {
    if (input.kind === 'TEST')
      assertRule(
        input.sessionId &&
          input.testType &&
          ['FIFTEEN_MINUTES', 'ONE_PERIOD', 'MIDTERM', 'FINAL'].includes(input.testType),
        'INVALID_ASSESSMENT_TYPE',
        'Tests require a session and test type',
        HttpStatus.BAD_REQUEST,
      );
    if (!input.sessionId) return;
    const session = await tx.classSession.findUnique({ where: { id: input.sessionId } });
    assertRule(session, 'SESSION_NOT_FOUND', 'Session not found', HttpStatus.NOT_FOUND);
    assertRule(
      session.classId === input.classId,
      'INVALID_ASSESSMENT_SESSION',
      'The selected session belongs to another class',
      HttpStatus.BAD_REQUEST,
    );
    assertRule(
      session.teacherId === user.id,
      'FORBIDDEN',
      'The selected session is not assigned to this teacher',
      HttpStatus.FORBIDDEN,
    );
    assertRule(
      session.status === 'SCHEDULED' && session.endsAt > new Date(),
      'INVALID_ASSESSMENT_SESSION',
      'Choose a scheduled session that has not ended',
    );
  }

  private async assertOwnedStudent(user: AuthenticatedUser, studentId: string): Promise<void> {
    const owned = await this.repo.db.studentProfile.count({
      where: { id: studentId, parentProfile: { userId: user.id } },
    });
    assertRule(
      owned === 1,
      'FORBIDDEN',
      'Student does not belong to this parent',
      HttpStatus.FORBIDDEN,
    );
  }

  private validateDefinition(input: AssignmentDto): void {
    assertRule(
      (input.kind ?? 'HOMEWORK') === 'TEST'
        ? !!input.sessionId &&
            !!input.testType &&
            ['FIFTEEN_MINUTES', 'ONE_PERIOD', 'MIDTERM', 'FINAL'].includes(input.testType)
        : !input.testType,
      'INVALID_ASSESSMENT_TYPE',
      'Tests require a session and test type; homework cannot have a test type',
      HttpStatus.BAD_REQUEST,
    );
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

  async list(user: AuthenticatedUser, page: StudentPageDto): Promise<unknown> {
    roles(user, 'TEACHER', 'PARENT');
    if (user.role === 'PARENT' && page.studentId)
      await this.assertOwnedStudent(user, page.studentId);
    const recipientWhere: Prisma.AssignmentRecipientWhereInput = {
      enrollment: {
        status: { not: 'PENDING_LINK' },
        ...(page.studentId ? { studentProfileId: page.studentId } : {}),
        ...(user.role === 'PARENT'
          ? { studentProfile: { parentProfile: { userId: user.id } } }
          : {}),
      },
    };
    const where: Prisma.AssignmentWhereInput =
      user.role === 'TEACHER'
        ? {
            class: assignedTeacherWhere(user.id, new Date()),
            ...(page.studentId ? { recipients: { some: recipientWhere } } : {}),
          }
        : { status: { not: 'DRAFT' }, recipients: { some: recipientWhere } };
    const items = this.repo.db.assignment
      .findMany({
        where,
        select: {
          id: true,
          classId: true,
          title: true,
          dueAt: true,
          status: true,
          maxAttempts: true,
          kind: true,
          testType: true,
          session: { select: { id: true, startsAt: true, endsAt: true } },
          class: {
            select: { id: true, name: true, program: { select: { subject: true, grade: true } } },
          },
          questions: { select: { kind: true, maxScore: true } },
          recipients: {
            where: recipientWhere,
            select: {
              id: true,
              enrollmentId: true,
              enrollment: { select: { studentProfileId: true } },
              submissions: {
                orderBy: { attemptNo: 'desc' },
                take: 1,
                select: {
                  id: true,
                  attemptNo: true,
                  submittedAt: true,
                  grades: {
                    where: { status: 'PUBLISHED' },
                    orderBy: { revision: 'desc' },
                    take: 1,
                    select: { totalScore: true, feedback: true, publishedAt: true },
                  },
                },
              },
            },
          },
        },
        skip: (page.page - 1) * page.limit,
        take: page.limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      })
      .then((rows) =>
        rows.map(({ questions, recipients, ...assignment }) => ({
          ...assignment,
          questionCounts: {
            multipleChoice: questions.filter((q) => q.kind === 'MULTIPLE_CHOICE').length,
            essay: questions.filter((q) => q.kind === 'ESSAY').length,
            total: questions.length,
          },
          maxScore: questions.reduce((sum, q) => sum + q.maxScore, 0),
          recipients: recipients.map(({ enrollment, submissions, ...recipient }) => ({
            ...recipient,
            studentId: enrollment.studentProfileId,
            latestSubmission: submissions[0]
              ? {
                  id: submissions[0].id,
                  attemptNo: submissions[0].attemptNo,
                  submittedAt: submissions[0].submittedAt,
                  publishedGrade: submissions[0].grades[0] ?? null,
                }
              : null,
          })),
        })),
      );
    return pageResult(page, items, () => this.repo.db.assignment.count({ where }));
  }

  async studentGrades(
    user: AuthenticatedUser,
    studentId: string,
    page: PageDto,
  ): Promise<ParentGradesResponseDto> {
    roles(user, 'PARENT');
    await this.assertOwnedStudent(user, studentId);
    const recipients = await this.repo.db.assignmentRecipient.findMany({
      where: {
        enrollment: {
          studentProfileId: studentId,
          status: { not: 'PENDING_LINK' },
          studentProfile: { parentProfile: { userId: user.id } },
        },
        assignment: { status: { not: 'DRAFT' } },
      },
      take: 20001,
      select: {
        id: true,
        assignment: {
          select: {
            id: true,
            title: true,
            kind: true,
            testType: true,
            class: { select: { id: true, name: true, program: { select: { subject: true } } } },
            questions: { select: { maxScore: true } },
          },
        },
        submissions: {
          where: { grades: { some: { status: 'PUBLISHED' } } },
          orderBy: { attemptNo: 'desc' },
          take: 1,
          select: {
            id: true,
            attemptNo: true,
            grades: {
              where: { status: 'PUBLISHED' },
              orderBy: { revision: 'desc' },
              take: 1,
              select: { totalScore: true, feedback: true, publishedAt: true },
            },
          },
        },
      },
    });
    assertRule(
      recipients.length <= 20000,
      'GRADE_HISTORY_TOO_LARGE',
      'Grade history exceeds the supported range',
    );
    const history = recipients
      .flatMap((recipient) => {
        const submission = recipient.submissions[0];
        const grade = submission?.grades[0];
        if (!grade) return [];
        const { questions, ...assignment } = recipient.assignment;
        const maxScore = questions.reduce((sum, question) => sum + question.maxScore, 0);
        return [
          {
            recipientId: recipient.id,
            assignment,
            submissionId: submission.id,
            attemptNo: submission.attemptNo,
            ...grade,
            maxScore,
            scoreOutOf10: maxScore ? (grade.totalScore / maxScore) * 10 : null,
          },
        ];
      })
      .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
    const subjects = [...new Set(history.map((row) => row.assignment.class.program.subject))].map(
      (subject) => {
        const scores = history.filter(
          (row) => row.assignment.class.program.subject === subject && row.scoreOutOf10 !== null,
        );
        return {
          subject,
          count: scores.length,
          averageOutOf10: scores.length
            ? Math.round(
                (scores.reduce((sum, row) => sum + row.scoreOutOf10!, 0) / scores.length) * 100,
              ) / 100
            : null,
        };
      },
    );
    return {
      studentId,
      subjects,
      history: history.slice((page.page - 1) * page.limit, page.page * page.limit),
      page: page.page,
      limit: page.limit,
      total: history.length,
    };
  }

  async backOfficeStudentGrades(user: AuthenticatedUser, studentId: string): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF');
    const student = await this.repo.db.studentProfile.findUnique({
      where: { id: studentId },
      select: { id: true },
    });
    assertRule(student, 'STUDENT_NOT_FOUND', 'Student not found', HttpStatus.NOT_FOUND);
    const recipients = await this.repo.db.assignmentRecipient.findMany({
      where: {
        enrollment: { studentProfileId: studentId },
        assignment: { status: { not: 'DRAFT' } },
      },
      select: {
        id: true,
        assignment: {
          select: {
            id: true,
            title: true,
            kind: true,
            testType: true,
            dueAt: true,
            status: true,
            class: { select: { id: true, name: true } },
            questions: { select: { maxScore: true } },
          },
        },
        submissions: {
          select: {
            id: true,
            attemptNo: true,
            submittedAt: true,
            grades: {
              where: { status: 'PUBLISHED' },
              select: { totalScore: true, publishedAt: true },
              orderBy: { revision: 'desc' },
              take: 1,
            },
          },
          orderBy: { attemptNo: 'desc' },
          take: 1,
        },
      },
      orderBy: { assignment: { dueAt: 'desc' } },
      take: 500,
    });
    return recipients.map(({ assignment, submissions }) => {
      const { questions, ...rest } = assignment;
      const latest = submissions[0];
      return {
        ...rest,
        maxScore: questions.reduce((sum, question) => sum + question.maxScore, 0),
        submission: latest
          ? { id: latest.id, attemptNo: latest.attemptNo, submittedAt: latest.submittedAt }
          : null,
        grade: latest?.grades[0] ?? null,
      };
    });
  }

  async detail(user: AuthenticatedUser, id: string): Promise<unknown> {
    roles(user, 'TEACHER', 'PARENT');
    const assignment = await this.repo.db.assignment.findUniqueOrThrow({
      where: { id },
      include: {
        session: { select: { id: true, startsAt: true, endsAt: true } },
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
      kind: assignment.kind,
      testType: assignment.testType,
      sessionId: assignment.sessionId,
      session: assignment.session,
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
      await this.validateSession(user, assignment, tx);
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
      const updated = await tx.assignment.update({ where: { id }, data: { status: 'PUBLISHED' } });
      await this.notifications.assignment(
        tx,
        user.id,
        id,
        'ASSIGNMENT_PUBLISHED',
        'Có bài tập mới được giao.',
        `assignment-published:${id}`,
      );
      return updated;
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
    const notificationOperationId = randomUUID();
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
      const updated = await tx.assignment.update({
        where: { id },
        data: { dueAt: new Date(input.dueAt), maxAttempts: input.maxAttempts, status: 'PUBLISHED' },
      });
      if (
        assignment.status !== updated.status ||
        assignment.dueAt.getTime() !== updated.dueAt.getTime() ||
        assignment.maxAttempts !== updated.maxAttempts
      )
        await this.notifications.assignment(
          tx,
          user.id,
          id,
          'ASSIGNMENT_REOPENED',
          `Hạn nộp mới: ${updated.dueAt.toISOString()}.`,
          notificationOperationId,
        );
      return updated;
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
      if (assignment.answersPublishedAt) return assignment;
      const updated = await tx.assignment.update({
        where: { id },
        data: { answersPublishedAt: new Date() },
      });
      await this.notifications.assignment(
        tx,
        user.id,
        id,
        'ANSWERS_PUBLISHED',
        'Đáp án đã được công bố.',
        `answers-published:${id}`,
      );
      return updated;
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
      const submitted = await tx.submission.create({
        data: {
          recipientId: recipient.id,
          attemptNo: attempts + 1,
          answers: input.answers.map((a) => ({ questionId: a.questionId, answer: a.answer })),
          files: { create: fileIds.map((fileId) => ({ fileId })) },
        },
        select: { id: true, recipientId: true, attemptNo: true, submittedAt: true },
      });
      const classroom = await tx.class.findUniqueOrThrow({ where: { id: assignment.classId } });
      const teacherId = assignedTeacherAt(classroom, new Date());
      await this.notifications.send(
        tx,
        user.id,
        'SUBMISSION_RECEIVED',
        'SUBMISSION',
        submitted.id,
        'Có bài nộp mới',
        `Bài tập ${assignment.title} có bài nộp mới.`,
        teacherId
          ? [
              {
                userId: teacherId,
                studentIds: recipient.enrollment.studentProfileId
                  ? [recipient.enrollment.studentProfileId]
                  : [],
              },
            ]
          : [],
        assignment.classId,
        `submission:${submitted.id}`,
      );
      return submitted;
    });
  }

  async submissions(
    user: AuthenticatedUser,
    assignmentId: string,
    page: PageDto,
  ): Promise<unknown> {
    roles(user, 'TEACHER', 'PARENT');
    if (user.role === 'TEACHER') await this.teacher(user, assignmentId);
    const where: Prisma.SubmissionWhereInput = {
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
    };
    return pageResult(
      page,
      this.repo.db.submission.findMany({
        where,
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
        orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
      }),
      () => this.repo.db.submission.count({ where }),
    );
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
      const published = await tx.gradeReview.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
      await this.notifications.family(
        tx,
        user.id,
        grade.submission.recipient.enrollmentId,
        'GRADE_PUBLISHED',
        'ASSIGNMENT',
        grade.submission.recipient.assignmentId,
        'Giáo viên đã công bố kết quả bài làm.',
        `grade:${id}:${grade.revision}`,
        true,
      );
      return published;
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
