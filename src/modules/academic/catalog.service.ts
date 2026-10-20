import { NotificationEventsService } from '../notifications/notification-events.service';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { assignedTeacherWhere } from '../registration-flow/class-teacher';
import { assertProgramFrequency } from '../registration-flow/program-frequency';
import {
  assertCurriculumSessionDates,
  lockCurriculumProgram,
} from '../curriculum-scheduling/curriculum-lifecycle';
import { AcademicRepository } from './academic.repository';
import { AcademicAccessService, assertRule, roles, studyDate } from './academic-access.service';
import {
  ClassDto,
  FeedbackDto,
  LessonDto,
  LessonRevisionDto,
  PageDto,
  ProgramDto,
  ResolveFeedbackDto,
  SessionDto,
} from './academic.dto';

@Injectable()
export class CatalogService {
  constructor(
    private readonly repo: AcademicRepository,
    private readonly access: AcademicAccessService,
    private readonly notifications: NotificationEventsService,
  ) {}

  async createProgram(user: AuthenticatedUser, input: ProgramDto): Promise<unknown> {
    roles(user, 'MANAGER');
    return this.repo.db.program.create({ data: input });
  }

  async programs(user: AuthenticatedUser, page: PageDto): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF', 'TEACHER', 'CURRICULUM_DESIGNER');
    return this.repo.db.program.findMany({
      skip: (page.page - 1) * page.limit,
      take: page.limit,
      orderBy: { id: 'asc' },
    });
  }

  async createClass(user: AuthenticatedUser, input: ClassDto): Promise<unknown> {
    roles(user, 'MANAGER');
    const teacher = await this.repo.db.user.findFirst({
      where: { id: input.teacherId, role: 'TEACHER', status: 'ACTIVE' },
    });
    assertRule(teacher, 'INVALID_TEACHER', 'An active teacher is required');
    return this.repo.db.class.create({ data: { ...input, isOpen: false } });
  }

  async classes(user: AuthenticatedUser, page: PageDto): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF', 'TEACHER');
    return this.repo.db.class.findMany({
      where: user.role === 'TEACHER' ? assignedTeacherWhere(user.id, new Date()) : {},
      skip: (page.page - 1) * page.limit,
      take: page.limit,
      orderBy: { id: 'asc' },
    });
  }

  async createLesson(user: AuthenticatedUser, input: LessonDto): Promise<unknown> {
    roles(user, 'CURRICULUM_DESIGNER');
    assertRule(
      user.role === 'MANAGER' || input.designerId === user.id,
      'FORBIDDEN',
      'Cannot assign another designer',
    );
    const designer = await this.repo.db.user.findFirst({
      where: { id: input.designerId, role: 'CURRICULUM_DESIGNER', status: 'ACTIVE' },
    });
    assertRule(designer, 'INVALID_DESIGNER', 'An active designer is required');
    return this.repo.db.lesson.create({ data: { ...input, designerId: user.id } });
  }

  async approveLesson(user: AuthenticatedUser, id: string): Promise<unknown> {
    roles(user, 'MANAGER');
    return this.repo.transaction(async (tx) => {
      const lesson = await tx.lesson.findUniqueOrThrow({
        where: { id },
        include: { unit: { select: { status: true } } },
      });
      assertRule(
        !lesson.unitId || lesson.unit?.status === 'APPROVED',
        'UNIT_APPROVAL_REQUIRED',
        'Approve the complete curriculum through teacher review and manager confirmation',
      );
      return tx.lesson.update({ where: { id }, data: { status: 'APPROVED' } });
    });
  }

  async lessons(user: AuthenticatedUser, page: PageDto): Promise<unknown> {
    roles(user, 'MANAGER', 'TEACHER', 'CURRICULUM_DESIGNER');
    const where: Prisma.LessonWhereInput =
      user.role === 'MANAGER'
        ? {}
        : user.role === 'CURRICULUM_DESIGNER'
          ? { designerId: user.id }
          : {
              status: 'APPROVED',
              sessions: {
                some: {
                  OR: [
                    { teacherId: user.id },
                    { class: assignedTeacherWhere(user.id, new Date()) },
                  ],
                },
              },
            };
    return this.repo.db.lesson.findMany({
      where,
      take: page.limit,
      skip: (page.page - 1) * page.limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async createSession(user: AuthenticatedUser, input: SessionDto): Promise<unknown> {
    roles(user, 'MANAGER');
    const start = new Date(input.startsAt),
      end = new Date(input.endsAt);
    assertRule(
      start < end && end.getTime() - start.getTime() <= 12 * 3600000,
      'INVALID_SESSION_TIME',
      'Session must last between zero and twelve hours',
    );
    const classHint = await this.repo.db.class.findUniqueOrThrow({ where: { id: input.classId } });
    return this.repo.transaction(async (tx) => {
      await lockCurriculumProgram(tx, classHint.programId);
      await tx.$queryRaw`SELECT id FROM classes WHERE id = ${input.classId} FOR UPDATE`;
      const classroom = await tx.class.findUniqueOrThrow({
        where: { id: input.classId },
        include: { program: true, weeklySchedules: true },
      });
      const lesson = await tx.lesson.findUniqueOrThrow({
        where: { id: input.lessonId },
        include: { unit: { select: { status: true, fromDate: true, toDate: true } } },
      });
      assertRule(
        lesson.kind !== 'MONTHLY_TEST',
        'TESTS_MANAGED_BY_TEACHER',
        'Teachers create tests separately for a chosen class session',
      );
      assertRule(
        !lesson.unitId || lesson.unit?.status === 'APPROVED',
        'UNIT_APPROVAL_REQUIRED',
        'Use lessons from a curriculum confirmed by the center',
      );
      assertRule(
        classroom.isOpen &&
          lesson.status === 'APPROVED' &&
          classroom.programId === lesson.programId,
        'INVALID_LESSON',
        'Use an approved lesson from the class program',
      );
      assertProgramFrequency(classroom.program, classroom.weeklySchedules.length, classroom.id);
      if (lesson.unit) assertCurriculumSessionDates(lesson.unit, start, end);
      const teacher = await tx.user.findFirst({
        where: { id: input.teacherId, role: 'TEACHER', status: 'ACTIVE' },
      });
      assertRule(teacher, 'INVALID_TEACHER', 'Active teacher required');
      const conflict = await tx.classSession.count({
        where: {
          status: { not: 'CANCELLED' },
          startsAt: { lt: end },
          endsAt: { gt: start },
          OR: [{ teacherId: input.teacherId }, { classId: input.classId }],
        },
      });
      assertRule(!conflict, 'SCHEDULE_CONFLICT', 'Class or teacher has an overlapping session');
      if (classroom.roomId) {
        const room = await tx.room.findUnique({ where: { id: classroom.roomId } });
        assertRule(
          room?.isActive && room.capacity >= classroom.capacity,
          'INVALID_ROOM',
          'Classroom capacity exceeds its active room',
        );
        const roomConflict = await tx.classSession.count({
          where: {
            roomId: classroom.roomId,
            status: { not: 'CANCELLED' },
            startsAt: { lt: end },
            endsAt: { gt: start },
          },
        });
        assertRule(!roomConflict, 'ROOM_SCHEDULE_CONFLICT', 'Room has an overlapping session');
      }
      return tx.classSession.create({
        data: { ...input, startsAt: start, endsAt: end, roomId: classroom.roomId },
      });
    });
  }

  async sessions(user: AuthenticatedUser, page: PageDto): Promise<unknown> {
    const where: Prisma.ClassSessionWhereInput =
      user.role === 'MANAGER' || user.role === 'STAFF'
        ? {}
        : user.role === 'TEACHER'
          ? { teacherId: user.id }
          : {
              participants: {
                some: {
                  cancelled: false,
                  enrollment: {
                    status: { not: 'PENDING_LINK' },
                    studentProfile: { parentProfile: { userId: user.id } },
                  },
                },
              },
            };
    roles(user, 'MANAGER', 'STAFF', 'TEACHER', 'PARENT');
    return this.repo.db.classSession.findMany({
      where,
      select: {
        id: true,
        classId: true,
        teacherId: true,
        startsAt: true,
        endsAt: true,
        status: true,
        summary: true,
        lesson: { select: { id: true, title: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: page.limit,
      skip: (page.page - 1) * page.limit,
    });
  }

  async prepareRoster(user: AuthenticatedUser, id: string): Promise<unknown> {
    roles(user, 'TEACHER');
    await this.access.session(user, id);
    return this.repo.transaction(async (tx) => {
      const session = await tx.classSession.findUniqueOrThrow({
        where: { id },
        include: { class: true },
      });
      assertRule(
        session.status === 'SCHEDULED',
        'SESSION_LOCKED',
        'Only scheduled sessions can prepare a roster',
      );
      const day = studyDate(session.startsAt);
      const enrollments = await tx.enrollment.findMany({
        where: {
          status: 'ACTIVE',
          studentProfileId: { not: null },
          startDate: { lte: day },
          endDate: { gt: day },
          OR: [
            {
              placements: {
                some: {
                  classId: session.classId,
                  effectiveFrom: { lte: session.startsAt },
                  OR: [{ effectiveTo: null }, { effectiveTo: { gt: session.startsAt } }],
                },
              },
            },
            { placements: { none: {} }, classId: session.classId },
          ],
        },
        include: {
          leaveRequests: {
            where: {
              status: 'APPROVED',
              kind: 'PERIOD_PAUSE',
              fromDate: { lte: day },
              toDate: { gte: day },
            },
          },
        },
      });
      for (const enrollment of enrollments) {
        const existing = await tx.sessionParticipant.findUnique({
          where: { sessionId_enrollmentId: { sessionId: id, enrollmentId: enrollment.id } },
        });
        assertRule(
          !existing || existing.kind === 'REGULAR' || existing.cancelled,
          'ROSTER_MAKEUP_CONFLICT',
          'Resolve the active makeup seat before adding this student as a regular participant',
        );
        await tx.sessionParticipant.upsert({
          where: { sessionId_enrollmentId: { sessionId: id, enrollmentId: enrollment.id } },
          create: {
            sessionId: id,
            enrollmentId: enrollment.id,
            attendance: enrollment.leaveRequests.length ? 'EXCUSED' : 'UNMARKED',
          },
          update: {
            kind: 'REGULAR',
            cancelled: false,
            ...(enrollment.leaveRequests.length ? { attendance: 'EXCUSED' as const } : {}),
          },
        });
      }
      const rows = await tx.sessionParticipant.findMany({
        where: { sessionId: id, cancelled: false },
        select: {
          id: true,
          enrollmentId: true,
          kind: true,
          attendance: true,
          enrollment: { select: { studentProfile: { select: { id: true, fullName: true } } } },
        },
      });
      assertRule(
        rows.filter((r) => r.attendance !== 'EXCUSED').length <= session.class.capacity,
        'SESSION_FULL',
        'Roster exceeds class capacity',
      );
      return rows;
    });
  }

  async feedback(user: AuthenticatedUser, lessonId: string, input: FeedbackDto): Promise<unknown> {
    roles(user, 'TEACHER');
    const assigned = await this.repo.db.classSession.count({
      where: {
        lessonId,
        OR: [{ teacherId: user.id }, { class: assignedTeacherWhere(user.id, new Date()) }],
      },
    });
    assertRule(assigned, 'FORBIDDEN', 'Lesson is not assigned to this teacher');
    return this.repo.transaction(async (tx) => {
      const feedback = await tx.curriculumFeedback.create({
        data: { lessonId, teacherId: user.id, content: input.content },
      });
      const lesson = await tx.lesson.findUniqueOrThrow({ where: { id: lessonId } });
      await this.notifications.send(
        tx,
        user.id,
        'FEEDBACK_CREATED',
        'FEEDBACK',
        feedback.id,
        'Có phản hồi giáo trình',
        `Bài ${lesson.title} có phản hồi cần xử lý.`,
        [
          ...(await this.notifications.recipients.roles(tx, ['MANAGER'])),
          { userId: lesson.designerId },
        ],
        undefined,
        `feedback:${feedback.id}`,
      );
      return feedback;
    });
  }

  async listFeedback(user: AuthenticatedUser, page: PageDto): Promise<unknown> {
    roles(user, 'MANAGER', 'TEACHER', 'CURRICULUM_DESIGNER');
    return this.repo.db.curriculumFeedback.findMany({
      where:
        user.role === 'MANAGER'
          ? {}
          : user.role === 'TEACHER'
            ? { teacherId: user.id }
            : { lesson: { designerId: user.id } },
      take: page.limit,
      skip: (page.page - 1) * page.limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolveFeedback(
    user: AuthenticatedUser,
    id: string,
    input: ResolveFeedbackDto,
  ): Promise<unknown> {
    roles(user, 'MANAGER', 'CURRICULUM_DESIGNER');
    const feedback = await this.repo.db.curriculumFeedback.findUniqueOrThrow({
      where: { id },
      include: { lesson: true },
    });
    assertRule(
      user.role === 'MANAGER' || feedback.lesson.designerId === user.id,
      'FORBIDDEN',
      'Feedback is assigned to another designer',
    );
    if (input.resolutionLessonId) {
      const revision = await this.repo.db.lesson.findUniqueOrThrow({
        where: { id: input.resolutionLessonId },
      });
      assertRule(
        revision.basedOnId === feedback.lessonId && revision.status === 'APPROVED',
        'INVALID_RESOLUTION',
        'Resolution must be an approved revision of the original lesson',
      );
    }
    return this.repo.transaction(async (tx) => {
      const current = await tx.curriculumFeedback.findUniqueOrThrow({ where: { id } });
      const updated = await tx.curriculumFeedback.update({ where: { id }, data: input });
      if (
        current.status !== updated.status ||
        current.response !== updated.response ||
        current.resolutionLessonId !== updated.resolutionLessonId
      )
        await this.notifications.send(
          tx,
          user.id,
          'FEEDBACK_RESOLVED',
          'FEEDBACK',
          id,
          'Phản hồi giáo trình đã được cập nhật',
          'Phản hồi của bạn đã có kết quả xử lý.',
          [{ userId: feedback.teacherId }, { userId: feedback.lesson.designerId }],
          undefined,
          `feedback-update:${id}:${updated.updatedAt.toISOString()}`,
        );
      return updated;
    });
  }

  async reviseLesson(
    user: AuthenticatedUser,
    id: string,
    input: LessonRevisionDto,
  ): Promise<unknown> {
    roles(user, 'CURRICULUM_DESIGNER');
    const lesson = await this.repo.db.lesson.findUniqueOrThrow({ where: { id } });
    assertRule(lesson.designerId === user.id, 'FORBIDDEN', 'Lesson belongs to another designer');
    assertRule(
      !lesson.unitId,
      'UNIT_REVISION_REQUIRED',
      'Create a future curriculum period instead of revising a lesson independently',
    );
    return this.repo.db.lesson.create({
      data: {
        ...input,
        programId: lesson.programId,
        designerId: user.id,
        sequence: lesson.sequence,
        basedOnId: id,
      },
    });
  }

  async enrollments(user: AuthenticatedUser, page: PageDto): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF', 'TEACHER', 'PARENT');
    const now = new Date();
    const where: Prisma.EnrollmentWhereInput =
      user.role === 'MANAGER' || user.role === 'STAFF'
        ? {}
        : user.role === 'PARENT'
          ? {
              status: { not: 'PENDING_LINK' },
              studentProfile: { parentProfile: { userId: user.id } },
            }
          : {
              OR: [
                {
                  placements: {
                    some: {
                      effectiveFrom: { lte: now },
                      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
                      class: assignedTeacherWhere(user.id, now),
                    },
                  },
                },
                { placements: { none: {} }, class: assignedTeacherWhere(user.id, now) },
              ],
            };
    return this.repo.db.enrollment.findMany({
      where,
      select: {
        id: true,
        classId: true,
        status: true,
        startDate: true,
        endDate: true,
        packageMonths: true,
        class: { select: { id: true, name: true } },
        studentProfile: { select: { id: true, fullName: true, grade: true } },
        placements: { select: { classId: true, effectiveFrom: true, effectiveTo: true } },
      },
      take: page.limit,
      skip: (page.page - 1) * page.limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async roster(user: AuthenticatedUser, id: string, page: PageDto): Promise<unknown> {
    // Staff only read rosters for scheduling; marking attendance stays with teachers and managers.
    if (user.role !== 'STAFF') await this.access.session(user, id);
    return this.repo.db.sessionParticipant.findMany({
      where: { sessionId: id, cancelled: false },
      select: {
        id: true,
        enrollmentId: true,
        kind: true,
        attendance: true,
        enrollment: { select: { studentProfile: { select: { id: true, fullName: true } } } },
      },
      take: page.limit,
      skip: (page.page - 1) * page.limit,
      orderBy: { id: 'asc' },
    });
  }
}
