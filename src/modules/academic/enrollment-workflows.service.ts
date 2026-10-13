import { HttpStatus, Injectable } from '@nestjs/common';
import type { Enrollment, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

function localStudyTime(value: Date | string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import {
  AcademicAccessService,
  assertRule,
  inTerm,
  roles,
  studyDate,
} from './academic-access.service';
import { AcademicRepository } from './academic.repository';
import { attendanceContribution } from './attendance-calculation';
import {
  AttendanceDto,
  AttendanceQueryDto,
  DecisionDto,
  EndLeaveEarlyDto,
  LeaveDto,
  LeaveFilterDto,
  MakeupDto,
  MakeupSourceFilterDto,
  PageDto,
  ReactivateStudentDto,
  RescheduleMakeupDto,
  TransferDto,
} from './academic.dto';

@Injectable()
export class EnrollmentWorkflowsService {
  constructor(
    private readonly repo: AcademicRepository,
    private readonly access: AcademicAccessService,
  ) {}

  private async queueFamilyEmail(
    tx: Prisma.TransactionClient,
    enrollmentId: string,
    eventType: string,
    aggregateId: string,
    content: string,
  ): Promise<void> {
    const enrollment = await tx.enrollment.findUnique({
      where: { id: enrollmentId },
      select: {
        studentProfile: {
          select: {
            fullName: true,
            parentProfile: { select: { user: { select: { email: true } } } },
          },
        },
      },
    });
    const student = enrollment?.studentProfile;
    if (!student) return;
    await tx.outboxEvent.create({
      data: {
        eventType,
        aggregateType: 'Enrollment',
        aggregateId: enrollmentId,
        recipient: student.parentProfile.user.email,
        subject: `EduGrade - Thông tin học tập của ${student.fullName}`,
        dedupeKey: `${eventType}:${aggregateId}:${randomUUID()}`,
        payload: { text: `${student.fullName}: ${content}` },
      },
    });
  }

  async leaves(user: AuthenticatedUser, query: LeaveFilterDto): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF', 'PARENT');
    const where: Prisma.LeaveRequestWhereInput = {
      ...(user.role === 'PARENT'
        ? { enrollment: { studentProfile: { parentProfile: { userId: user.id } } } }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.studentId
        ? {
            enrollment: {
              studentProfileId: query.studentId,
              ...(user.role === 'PARENT'
                ? { studentProfile: { parentProfile: { userId: user.id } } }
                : {}),
            },
          }
        : {}),
      // Overlap with [fromDate, toDate]; leave dates are inclusive calendar days.
      ...(query.toDate ? { fromDate: { lte: new Date(query.toDate) } } : {}),
      ...(query.fromDate ? { toDate: { gte: new Date(query.fromDate) } } : {}),
    };
    return this.repo.db.leaveRequest.findMany({
      where,
      include: {
        enrollment: {
          select: {
            id: true,
            status: true,
            studentProfile: { select: { id: true, fullName: true, grade: true } },
            class: { select: { id: true, name: true } },
          },
        },
      },
      take: query.limit,
      skip: (query.page - 1) * query.limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async makeups(user: AuthenticatedUser, page: PageDto): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF', 'TEACHER', 'PARENT');
    const where: Prisma.MakeupBookingWhereInput =
      user.role === 'MANAGER' || user.role === 'STAFF'
        ? {}
        : user.role === 'TEACHER'
          ? { replacement: { session: { teacherId: user.id } } }
          : {
              original: { enrollment: { studentProfile: { parentProfile: { userId: user.id } } } },
            };
    return this.repo.db.makeupBooking.findMany({
      where,
      select: {
        id: true,
        status: true,
        originalParticipantId: true,
        replacementParticipantId: true,
        original: { select: { sessionId: true, enrollmentId: true } },
        replacement: {
          select: {
            session: { select: { id: true, classId: true, startsAt: true, endsAt: true } },
          },
        },
      },
      take: page.limit,
      skip: (page.page - 1) * page.limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async requestLeave(user: AuthenticatedUser, input: LeaveDto): Promise<unknown> {
    roles(user, 'STAFF', 'PARENT');
    await this.access.enrollment(user, input.enrollmentId);
    const from = new Date(input.fromDate),
      to = new Date(input.toDate);
    assertRule(
      /^\d{4}-\d{2}-\d{2}$/.test(input.fromDate) && /^\d{4}-\d{2}-\d{2}$/.test(input.toDate),
      'INVALID_DATE',
      'Use YYYY-MM-DD dates',
    );
    assertRule(from <= to, 'INVALID_DATE_RANGE', 'Start must not follow end');
    assertRule(
      (input.kind === 'SINGLE_ABSENCE') === !!input.sessionId,
      'INVALID_LEAVE',
      'Single absence requires a session; period pause must omit it',
    );
    const data = { ...input, fromDate: from, toDate: to, requestedById: user.id };
    return this.repo.transaction(async (tx) => {
      const enrollment = await tx.enrollment.findUniqueOrThrow({
        where: { id: input.enrollmentId },
        include: { studentProfile: true, placements: true },
      });
      assertRule(
        enrollment.status === 'ACTIVE' &&
          enrollment.studentProfile?.status === 'ACTIVE' &&
          enrollment.startDate &&
          enrollment.endDate &&
          from >= enrollment.startDate &&
          to < enrollment.endDate,
        'OUTSIDE_ENROLLMENT',
        'Leave must fall inside an active student enrollment',
      );
      if (input.sessionId) {
        const session = await tx.classSession.findUniqueOrThrow({ where: { id: input.sessionId } });
        const placed = enrollment.placements.length
          ? enrollment.placements.some(
              (placement) =>
                placement.classId === session.classId &&
                placement.effectiveFrom <= session.startsAt &&
                (!placement.effectiveTo || placement.effectiveTo > session.startsAt),
            )
          : enrollment.classId === session.classId;
        assertRule(
          placed && session.status === 'SCHEDULED' && inTerm(enrollment, session.startsAt),
          'INVALID_SESSION',
          'Select a scheduled regular session inside the enrollment placement',
        );
        assertRule(
          from.getTime() === studyDate(session.startsAt).getTime() &&
            from.getTime() === to.getTime(),
          'INVALID_LEAVE_DATE',
          'Single absence must match the session date',
        );
        const existing = await tx.sessionParticipant.findUnique({
          where: {
            sessionId_enrollmentId: {
              sessionId: input.sessionId,
              enrollmentId: input.enrollmentId,
            },
          },
        });
        assertRule(
          !existing || existing.kind === 'REGULAR' || existing.cancelled,
          'INVALID_SESSION',
          'An active makeup seat cannot be used as the regular absence source',
        );
        await tx.sessionParticipant.upsert({
          where: {
            sessionId_enrollmentId: {
              sessionId: input.sessionId,
              enrollmentId: input.enrollmentId,
            },
          },
          create: { sessionId: input.sessionId, enrollmentId: input.enrollmentId },
          update: { kind: 'REGULAR', cancelled: false },
        });
      }
      const leave = await tx.leaveRequest.create({ data });
      if (user.role !== 'STAFF') {
        await this.queueFamilyEmail(
          tx,
          leave.enrollmentId,
          'LEAVE_REQUESTED',
          leave.id,
          `Đã ghi nhận yêu cầu nghỉ từ ${input.fromDate} đến ${input.toDate}.`,
        );
        return leave;
      }
      // Staff record leave on behalf of the parent, so it is approved in the same transaction.
      return this.decideLeave(user, leave.id, { approve: true, reason: input.reason }, tx);
    });
  }

  async decideLeave(
    user: AuthenticatedUser,
    id: string,
    input: DecisionDto,
    outer?: Prisma.TransactionClient,
  ): Promise<unknown> {
    roles(user, 'STAFF');
    const run = async (tx: Prisma.TransactionClient): Promise<unknown> => {
      const leave = await tx.leaveRequest.findUniqueOrThrow({ where: { id } });
      assertRule(leave.status === 'PENDING', 'REQUEST_DECIDED', 'Request has already been decided');
      if (input.approve) {
        const enrollment = await tx.enrollment.findUniqueOrThrow({
          where: { id: leave.enrollmentId },
        });
        assertRule(
          enrollment.status === 'ACTIVE',
          'ENROLLMENT_ENDED',
          'Leave cannot be approved for an inactive enrollment',
        );
        const overlap = await tx.leaveRequest.count({
          where: {
            enrollmentId: leave.enrollmentId,
            status: 'APPROVED',
            fromDate: { lte: leave.toDate },
            toDate: { gte: leave.fromDate },
          },
        });
        assertRule(!overlap, 'LEAVE_OVERLAP', 'An approved leave overlaps this request');
        const rows = await tx.sessionParticipant.findMany({
          where: {
            enrollmentId: leave.enrollmentId,
            cancelled: false,
            session: {
              startsAt: {
                gte: new Date(leave.fromDate.getTime() - 7 * 3600000),
                lt: new Date(leave.toDate.getTime() + 17 * 3600000),
              },
            },
          },
          include: {
            session: true,
            replacementBookings: { where: { status: 'BOOKED' } },
            sourceBookings: { where: { status: 'BOOKED' } },
          },
        });
        assertRule(
          rows.every(
            (r) =>
              r.session.status === 'SCHEDULED' &&
              !r.replacementBookings.length &&
              !r.sourceBookings.length,
          ),
          'LEAVE_HAS_ACTIVITY',
          'Cancel makeups or resolve completed sessions before approving leave',
        );
        if (leave.kind === 'PERIOD_PAUSE')
          await tx.sessionParticipant.updateMany({
            where: { id: { in: rows.map((r) => r.id) } },
            data: { attendance: 'EXCUSED' },
          });
      }
      const updated = await tx.leaveRequest.update({
        where: { id },
        data: {
          status: input.approve ? 'APPROVED' : 'REJECTED',
          decidedById: user.id,
          decisionNote: input.reason,
        },
      });
      await this.queueFamilyEmail(
        tx,
        leave.enrollmentId,
        'LEAVE_DECIDED',
        id,
        `Yêu cầu nghỉ từ ${leave.fromDate.toISOString().slice(0, 10)} đến ${leave.toDate.toISOString().slice(0, 10)} đã ${input.approve ? 'được duyệt' : 'bị từ chối'}.`,
      );
      return updated;
    };
    return outer ? run(outer) : this.repo.transaction(run);
  }

  async cancelLeave(user: AuthenticatedUser, id: string): Promise<unknown> {
    roles(user, 'STAFF');
    return this.repo.transaction(async (tx) => {
      const leave = await tx.leaveRequest.findUniqueOrThrow({ where: { id } });
      assertRule(
        leave.status === 'PENDING' || leave.status === 'APPROVED',
        'REQUEST_DECIDED',
        'Leave cannot be cancelled',
      );
      if (leave.status === 'APPROVED' && leave.kind === 'PERIOD_PAUSE') {
        const startsAt = {
          gte: new Date(leave.fromDate.getTime() - 7 * 3600000),
          lt: new Date(leave.toDate.getTime() + 17 * 3600000),
        };
        const completed = await tx.sessionParticipant.count({
          where: { enrollmentId: leave.enrollmentId, session: { startsAt, status: 'COMPLETED' } },
        });
        assertRule(!completed, 'LEAVE_HAS_ACTIVITY', 'Historical leave cannot be cancelled');
        await tx.sessionParticipant.updateMany({
          where: {
            enrollmentId: leave.enrollmentId,
            attendance: 'EXCUSED',
            session: { startsAt, status: 'SCHEDULED' },
          },
          data: { attendance: 'UNMARKED' },
        });
      }
      const cancelled = await tx.leaveRequest.update({
        where: { id },
        data: { status: 'CANCELLED', decidedById: user.id },
      });
      await this.queueFamilyEmail(
        tx,
        leave.enrollmentId,
        'LEAVE_CANCELLED',
        id,
        'Yêu cầu nghỉ đã được hủy.',
      );
      return cancelled;
    });
  }

  async endLeaveEarly(
    user: AuthenticatedUser,
    id: string,
    input: EndLeaveEarlyDto,
  ): Promise<unknown> {
    roles(user, 'STAFF');
    return this.repo.transaction(async (tx) => {
      const leave = await tx.leaveRequest.findUniqueOrThrow({ where: { id } });
      assertRule(
        leave.kind === 'PERIOD_PAUSE' && leave.status === 'APPROVED',
        'INVALID_LEAVE_STATE',
        'Only an approved period pause can end early',
      );
      const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
      assertRule(
        input.effectiveDate >= today,
        'INVALID_EFFECTIVE_DATE',
        'Effective date cannot be in the past',
        HttpStatus.BAD_REQUEST,
      );
      const effective = new Date(`${input.effectiveDate}T00:00:00.000Z`);
      assertRule(
        effective > leave.fromDate && effective <= leave.toDate,
        'INVALID_EFFECTIVE_DATE',
        'Effective date must fall inside the pause',
        HttpStatus.BAD_REQUEST,
      );
      const shortenedTo = new Date(effective.getTime() - 86_400_000);
      const startsAt = {
        gte: new Date(effective.getTime() - 7 * 3600000),
        lt: new Date(leave.toDate.getTime() + 17 * 3600000),
      };
      const otherLeaves = await tx.leaveRequest.findMany({
        where: {
          enrollmentId: leave.enrollmentId,
          id: { not: id },
          kind: 'PERIOD_PAUSE',
          status: 'APPROVED',
          fromDate: { lte: leave.toDate },
          toDate: { gte: effective },
        },
        select: { fromDate: true, toDate: true },
      });
      await tx.sessionParticipant.updateMany({
        where: {
          enrollmentId: leave.enrollmentId,
          attendance: 'EXCUSED',
          session: {
            status: 'SCHEDULED',
            startsAt,
            NOT: otherLeaves.map((other) => ({
              startsAt: {
                gte: new Date(other.fromDate.getTime() - 7 * 3600000),
                lt: new Date(other.toDate.getTime() + 17 * 3600000),
              },
            })),
          },
        },
        data: { attendance: 'UNMARKED' },
      });
      const updated = await tx.leaveRequest.update({
        where: { id },
        data: { toDate: shortenedTo, decisionNote: input.reason, decidedById: user.id },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'LEAVE_END_EARLY',
          entityType: 'LeaveRequest',
          entityId: id,
          beforeData: { toDate: leave.toDate },
          afterData: { toDate: shortenedTo, reason: input.reason },
        },
      });
      await this.queueFamilyEmail(
        tx,
        leave.enrollmentId,
        'LEAVE_ENDED_EARLY',
        id,
        `Kỳ nghỉ kết thúc sớm; ngày trở lại học là ${input.effectiveDate}.`,
      );
      return updated;
    });
  }

  async makeupSources(user: AuthenticatedUser, query: MakeupSourceFilterDto): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF');
    return this.repo.db.sessionParticipant.findMany({
      where: {
        cancelled: false,
        kind: 'REGULAR',
        attendance: { notIn: ['PRESENT', 'EXCUSED'] },
        session: { status: { not: 'CANCELLED' } },
        sourceBookings: { none: { status: { in: ['BOOKED', 'COMPLETED'] } } },
        enrollment: {
          status: 'ACTIVE',
          ...(query.studentId ? { studentProfileId: query.studentId } : {}),
        },
      },
      select: {
        id: true,
        attendance: true,
        enrollmentId: true,
        enrollment: {
          select: { studentProfile: { select: { id: true, fullName: true, grade: true } } },
        },
        session: {
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            status: true,
            lesson: { select: { id: true, title: true } },
            class: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { session: { startsAt: 'desc' } },
      take: query.limit,
      skip: (query.page - 1) * query.limit,
    });
  }

  async makeupCandidates(
    user: AuthenticatedUser,
    participantId: string,
    page: PageDto,
  ): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF');
    return this.repo.transaction(async (tx) => {
      const original = await tx.sessionParticipant.findUniqueOrThrow({
        where: { id: participantId },
        include: { session: true },
      });
      const targets = await tx.classSession.findMany({
        where: {
          id: { not: original.sessionId },
          lessonId: original.session.lessonId,
          startsAt: { gt: new Date() },
          status: 'SCHEDULED',
        },
        include: { class: { select: { name: true, capacity: true } } },
        take: page.limit,
        skip: (page.page - 1) * page.limit,
        orderBy: { startsAt: 'asc' },
      });
      return Promise.all(
        targets.map(async (target) => {
          const state = await this.makeupTargetState(tx, participantId, target.id);
          return {
            ...target,
            eligible: state.reasonCodes.length === 0,
            availableSeats: state.availableSeats,
            reasonCodes: state.reasonCodes,
          };
        }),
      );
    });
  }

  async bookMakeup(user: AuthenticatedUser, input: MakeupDto): Promise<unknown> {
    roles(user, 'STAFF');
    return this.repo.transaction(async (tx) => {
      const state = await this.makeupTargetState(
        tx,
        input.originalParticipantId,
        input.targetSessionId,
      );
      const problem = state.reasonCodes[0];
      assertRule(!problem, problem ?? 'INVALID_MAKEUP_TARGET', 'Makeup target is not eligible');
      const { source, target } = state;
      const existing = await tx.sessionParticipant.findUnique({
        where: {
          sessionId_enrollmentId: { sessionId: target.id, enrollmentId: source.enrollmentId },
        },
        include: { replacementBookings: { where: { status: { in: ['BOOKED', 'COMPLETED'] } } } },
      });
      assertRule(
        !existing ||
          (existing.kind === 'MAKEUP' &&
            existing.cancelled &&
            !existing.replacementBookings.length),
        'MAKEUP_TARGET_OCCUPIED',
        'This enrollment already has an active or completed seat in the target session',
      );
      const replacement = existing
        ? await tx.sessionParticipant.update({
            where: { id: existing.id },
            data: { cancelled: false, attendance: 'UNMARKED' },
          })
        : await tx.sessionParticipant.create({
            data: { sessionId: target.id, enrollmentId: source.enrollmentId, kind: 'MAKEUP' },
          });
      const booking = await tx.makeupBooking.create({
        data: {
          originalParticipantId: source.id,
          activeOriginalId: source.id,
          replacementParticipantId: replacement.id,
          managerId: user.id,
        },
      });
      await this.queueFamilyEmail(
        tx,
        source.enrollmentId,
        'MAKEUP_BOOKED',
        booking.id,
        `Đã đặt buổi học bù vào ${localStudyTime(target.startsAt)}.`,
      );
      return booking;
    });
  }

  async attendanceSummary(
    user: AuthenticatedUser,
    input: AttendanceQueryDto & { classId?: string; studentId?: string },
  ): Promise<unknown> {
    assertRule(
      (user.role === 'TEACHER' && !!input.classId) || (user.role === 'PARENT' && !!input.studentId),
      'FORBIDDEN',
      'Attendance scope is not allowed',
      HttpStatus.FORBIDDEN,
    );
    if (user.role === 'TEACHER') await this.access.classroom(user, input.classId!);
    if (user.role === 'PARENT') {
      const owned = await this.repo.db.studentProfile.count({
        where: { id: input.studentId, parentProfile: { userId: user.id } },
      });
      assertRule(
        owned === 1,
        'FORBIDDEN',
        'Student does not belong to this parent',
        HttpStatus.FORBIDDEN,
      );
    }
    const from = input.fromDate
      ? new Date(
          /^\d{4}-\d{2}-\d{2}$/.test(input.fromDate)
            ? `${input.fromDate}T00:00:00.000+07:00`
            : input.fromDate,
        )
      : new Date(0);
    const to = input.toDate
      ? new Date(
          /^\d{4}-\d{2}-\d{2}$/.test(input.toDate)
            ? `${input.toDate}T23:59:59.999+07:00`
            : input.toDate,
        )
      : new Date();
    assertRule(from <= to, 'INVALID_DATE_RANGE', 'Start must not follow end');
    const rows = await this.repo.db.sessionParticipant.findMany({
      where: {
        kind: 'REGULAR',
        cancelled: false,
        session: {
          ...(input.classId ? { classId: input.classId } : {}),
          startsAt: { gte: from, lte: to },
          status: 'COMPLETED',
        },
        enrollment: input.studentId ? { studentProfileId: input.studentId } : {},
      },
      select: {
        id: true,
        attendance: true,
        enrollmentId: true,
        enrollment: { select: { studentProfile: { select: { id: true, fullName: true } } } },
        session: { select: { id: true, classId: true, startsAt: true, endsAt: true } },
        sourceBookings: {
          where: { status: 'COMPLETED' },
          select: { id: true, replacement: { select: { sessionId: true } } },
        },
      },
      orderBy: { session: { startsAt: 'asc' } },
      take: 20001,
    });
    assertRule(rows.length <= 20000, 'ATTENDANCE_TOO_LARGE', 'Reduce the attendance date range');
    const counts = { present: 0, absent: 0, madeUp: 0, excused: 0, required: 0, attended: 0 };
    const students = new Map<
      string,
      {
        studentId: string;
        fullName: string;
        counts: typeof counts;
        attendancePercent: number | null;
      }
    >();
    const history = rows.map((row) => {
      const student = row.enrollment.studentProfile;
      assertRule(student, 'STUDENT_NOT_FOUND', 'Attendance student profile is missing');
      if (!students.has(student.id)) {
        students.set(student.id, {
          studentId: student.id,
          fullName: student.fullName,
          counts: { present: 0, absent: 0, madeUp: 0, excused: 0, required: 0, attended: 0 },
          attendancePercent: null,
        });
      }
      const studentCounts = students.get(student.id)!.counts;
      const { effectiveStatus, required, attended } = attendanceContribution(
        row.attendance,
        row.sourceBookings.length > 0,
      );
      const key =
        effectiveStatus === 'PRESENT'
          ? 'present'
          : effectiveStatus === 'MADE_UP'
            ? 'madeUp'
            : effectiveStatus === 'EXCUSED'
              ? 'excused'
              : 'absent';
      counts[key]++;
      studentCounts[key]++;
      counts.required += required;
      studentCounts.required += required;
      counts.attended += attended;
      studentCounts.attended += attended;
      return { ...row, effectiveStatus };
    });
    for (const student of students.values()) {
      student.attendancePercent = student.counts.required
        ? Math.round((student.counts.attended / student.counts.required) * 10000) / 100
        : null;
    }
    return {
      range: { from: input.fromDate ?? null, to: input.toDate ?? null },
      counts,
      students: [...students.values()],
      attendancePercent: counts.required
        ? Math.round((counts.attended / counts.required) * 10000) / 100
        : null,
      history,
    };
  }

  private async makeupTargetState(
    tx: Prisma.TransactionClient,
    sourceId: string,
    targetId: string,
  ): Promise<{
    source: Prisma.SessionParticipantGetPayload<{ include: { session: true; enrollment: true } }>;
    target: Prisma.ClassSessionGetPayload<{ include: { class: true } }>;
    availableSeats: number;
    reasonCodes: string[];
  }> {
    const source = await tx.sessionParticipant.findUniqueOrThrow({
      where: { id: sourceId },
      include: { session: true, enrollment: true },
    });
    const target = await tx.classSession.findUniqueOrThrow({
      where: { id: targetId },
      include: { class: true },
    });
    const reasonCodes: string[] = [];
    if (
      source.cancelled ||
      source.kind !== 'REGULAR' ||
      source.attendance === 'PRESENT' ||
      source.attendance === 'EXCUSED'
    )
      reasonCodes.push('INVALID_MAKEUP_SOURCE');
    if (
      source.session.status === 'CANCELLED' ||
      target.id === source.sessionId ||
      target.lessonId !== source.session.lessonId ||
      target.status !== 'SCHEDULED' ||
      target.startsAt <= new Date()
    )
      reasonCodes.push('INVALID_MAKEUP_TARGET');
    if (!inTerm(source.enrollment, target.startsAt)) reasonCodes.push('OUTSIDE_ENROLLMENT');
    if (source.session.status !== 'COMPLETED') {
      const approved = await tx.leaveRequest.count({
        where: {
          enrollmentId: source.enrollmentId,
          sessionId: source.sessionId,
          status: 'APPROVED',
          kind: 'SINGLE_ABSENCE',
        },
      });
      if (!approved) reasonCodes.push('ABSENCE_NOT_APPROVED');
    }
    const day = studyDate(target.startsAt);
    const [leave, conflict, regularReservations, extra] = await Promise.all([
      tx.leaveRequest.count({
        where: {
          enrollmentId: source.enrollmentId,
          status: 'APPROVED',
          fromDate: { lte: day },
          toDate: { gte: day },
        },
      }),
      tx.sessionParticipant.count({
        where: {
          cancelled: false,
          id: { not: source.id },
          enrollment: { studentProfileId: source.enrollment.studentProfileId },
          session: {
            status: { not: 'CANCELLED' },
            startsAt: { lt: target.endsAt },
            endsAt: { gt: target.startsAt },
          },
        },
      }),
      this.reservations(tx, target.classId, target.startsAt),
      tx.sessionParticipant.count({
        where: { sessionId: target.id, cancelled: false, kind: 'MAKEUP' },
      }),
    ]);
    if (leave) reasonCodes.push('TARGET_DURING_LEAVE');
    if (conflict) reasonCodes.push('STUDENT_SCHEDULE_CONFLICT');
    const availableSeats = Math.max(0, target.class.capacity - regularReservations - extra);
    if (!availableSeats) reasonCodes.push('SESSION_FULL');
    return { source, target, availableSeats, reasonCodes: [...new Set(reasonCodes)] };
  }

  async cancelMakeup(user: AuthenticatedUser, id: string): Promise<unknown> {
    roles(user, 'STAFF');
    return this.repo.transaction(async (tx) => {
      const booking = await tx.makeupBooking.findUniqueOrThrow({
        where: { id },
        include: { replacement: { include: { session: true } } },
      });
      assertRule(
        booking.status === 'BOOKED' && booking.replacement.session.status === 'SCHEDULED',
        'MAKEUP_LOCKED',
        'Only an uncompleted booking can be cancelled',
      );
      await tx.sessionParticipant.update({
        where: { id: booking.replacementParticipantId },
        data: { cancelled: true },
      });
      const cancelled = await tx.makeupBooking.update({
        where: { id },
        data: { status: 'CANCELLED', activeOriginalId: null },
      });
      const original = await tx.sessionParticipant.findUniqueOrThrow({
        where: { id: booking.originalParticipantId },
      });
      await this.queueFamilyEmail(
        tx,
        original.enrollmentId,
        'MAKEUP_CANCELLED',
        id,
        'Buổi học bù đã được hủy.',
      );
      return cancelled;
    });
  }

  async rescheduleMakeup(
    user: AuthenticatedUser,
    id: string,
    input: RescheduleMakeupDto,
  ): Promise<unknown> {
    roles(user, 'STAFF');
    return this.repo.transaction(async (tx) => {
      const booking = await tx.makeupBooking.findUniqueOrThrow({
        where: { id },
        include: { replacement: { include: { session: true } } },
      });
      assertRule(
        booking.status === 'BOOKED' && booking.replacement.session.status === 'SCHEDULED',
        'MAKEUP_LOCKED',
        'Only an uncompleted booking can be rescheduled',
      );
      assertRule(
        booking.replacement.sessionId !== input.targetSessionId,
        'SAME_MAKEUP_TARGET',
        'Choose another session',
      );
      const state = await this.makeupTargetState(
        tx,
        booking.originalParticipantId,
        input.targetSessionId,
      );
      const problem = state.reasonCodes[0];
      assertRule(!problem, problem ?? 'INVALID_MAKEUP_TARGET', 'Makeup target is not eligible');
      const existing = await tx.sessionParticipant.findUnique({
        where: {
          sessionId_enrollmentId: {
            sessionId: state.target.id,
            enrollmentId: state.source.enrollmentId,
          },
        },
        include: { replacementBookings: { where: { status: { in: ['BOOKED', 'COMPLETED'] } } } },
      });
      assertRule(
        !existing ||
          (existing.kind === 'MAKEUP' &&
            existing.cancelled &&
            !existing.replacementBookings.length),
        'MAKEUP_TARGET_OCCUPIED',
        'This enrollment already occupies the target session',
      );
      const replacement = existing
        ? await tx.sessionParticipant.update({
            where: { id: existing.id },
            data: { cancelled: false, attendance: 'UNMARKED' },
          })
        : await tx.sessionParticipant.create({
            data: {
              sessionId: state.target.id,
              enrollmentId: state.source.enrollmentId,
              kind: 'MAKEUP',
            },
          });
      await tx.sessionParticipant.update({
        where: { id: booking.replacementParticipantId },
        data: { cancelled: true },
      });
      const updated = await tx.makeupBooking.update({
        where: { id },
        data: { replacementParticipantId: replacement.id, managerId: user.id },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'MAKEUP_RESCHEDULE',
          entityType: 'MakeupBooking',
          entityId: id,
          beforeData: { sessionId: booking.replacement.sessionId },
          afterData: { sessionId: state.target.id, reason: input.reason },
        },
      });
      await this.queueFamilyEmail(
        tx,
        state.source.enrollmentId,
        'MAKEUP_RESCHEDULED',
        id,
        `Buổi học bù được chuyển sang ${localStudyTime(state.target.startsAt)}.`,
      );
      return updated;
    });
  }

  async finalizeAttendance(
    user: AuthenticatedUser,
    id: string,
    input: AttendanceDto,
  ): Promise<unknown> {
    roles(user, 'TEACHER');
    await this.access.session(user, id);
    return this.repo.transaction(async (tx) => {
      const session = await tx.classSession.findUniqueOrThrow({
        where: { id },
        include: {
          participants: {
            where: { cancelled: false },
            include: {
              replacementBookings: { where: { status: 'BOOKED' } },
              sourceBookings: { where: { status: { in: ['BOOKED', 'COMPLETED'] } } },
            },
          },
        },
      });
      assertRule(
        session.status === 'SCHEDULED' && session.endsAt <= new Date(),
        'SESSION_NOT_FINISHED',
        'Only an elapsed, unfinalized session may be finalized',
      );
      assertRule(
        input.items.length === session.participants.length &&
          new Set(input.items.map((i) => i.participantId)).size === input.items.length,
        'INCOMPLETE_ATTENDANCE',
        'Provide exactly one result per participant',
      );
      for (const row of session.participants) {
        const item = input.items.find((i) => i.participantId === row.id);
        assertRule(
          item && item.status !== 'UNMARKED',
          'INCOMPLETE_ATTENDANCE',
          'Every participant needs a final status',
        );
        assertRule(
          (row.attendance === 'EXCUSED') === (item.status === 'EXCUSED'),
          'EXCUSED_REQUIRES_LEAVE',
          'Excused attendance is controlled by approved leave',
        );
        assertRule(
          !row.sourceBookings.length || item.status === 'ABSENT',
          'MAKEUP_SOURCE_ABSENT',
          'A swapped session must remain absent at its original location',
        );
        await tx.sessionParticipant.update({
          where: { id: row.id },
          data: { attendance: item.status },
        });
        const replacementBooking = row.replacementBookings[0];
        if (replacementBooking)
          await tx.makeupBooking.update({
            where: { id: replacementBooking.id },
            data: {
              status: item.status === 'PRESENT' ? 'COMPLETED' : 'MISSED',
              activeOriginalId:
                item.status === 'PRESENT' ? replacementBooking.originalParticipantId : null,
            },
          });
      }
      const completed = await tx.classSession.update({
        where: { id },
        data: { status: 'COMPLETED', summary: input.summary },
      });
      for (const participant of session.participants) {
        const status = input.items.find((item) => item.participantId === participant.id)!.status;
        await this.queueFamilyEmail(
          tx,
          participant.enrollmentId,
          'ATTENDANCE_FINALIZED',
          `${id}:${participant.id}`,
          `Điểm danh buổi ${localStudyTime(session.startsAt)}: ${status === 'PRESENT' ? 'có mặt' : status === 'EXCUSED' ? 'vắng có phép' : 'vắng mặt'}.`,
        );
      }
      return completed;
    });
  }

  async transfer(user: AuthenticatedUser, id: string, input: TransferDto): Promise<unknown> {
    roles(user, 'STAFF');
    return this.repo.transaction(async (tx) => {
      const enrollment = await tx.enrollment.findUniqueOrThrow({
        where: { id },
        include: { class: true, placements: { orderBy: { effectiveFrom: 'desc' } } },
      });
      const target = await tx.class.findUniqueOrThrow({ where: { id: input.targetClassId } });
      const at = new Date(input.effectiveAt);
      assertRule(
        at >= new Date() && inTerm(enrollment, at),
        'INVALID_TRANSFER_DATE',
        'Transfer must be future and inside the active term',
      );
      const current = enrollment.placements.find(
        (p) => p.effectiveFrom <= at && (!p.effectiveTo || p.effectiveTo > at),
      );
      const fromClassId = current?.classId ?? enrollment.classId;
      const fromClass = await tx.class.findUniqueOrThrow({ where: { id: fromClassId } });
      assertRule(
        target.id !== fromClassId &&
          target.isOpen &&
          target.programId === fromClass.programId &&
          target.monthlyFee.equals(fromClass.monthlyFee),
        'INVALID_TRANSFER_CLASS',
        'Transfer requires a different open class with the same program and fee',
      );
      assertRule(
        !enrollment.placements.some((p) => p.effectiveFrom > at),
        'TRANSFER_ALREADY_SCHEDULED',
        'Resolve future placements first',
      );
      assertRule(
        (await this.reservations(tx, target.id, at)) < target.capacity,
        'CLASS_FULL',
        'Target class is full',
      );
      const endExclusive = new Date(enrollment.endDate!.getTime() + 17 * 3600000);
      const futureSeats = await tx.enrollmentPlacement.count({
        where: {
          classId: target.id,
          effectiveFrom: { gt: at, lt: endExclusive },
          enrollment: { status: { in: ['ACTIVE', 'PENDING_LINK'] } },
        },
      });
      assertRule(
        (await this.reservations(tx, target.id, at)) + futureSeats < target.capacity,
        'FUTURE_CLASS_FULL',
        'Target has future seat reservations',
      );
      const makeups = await tx.makeupBooking.count({
        where: { status: 'BOOKED', original: { enrollmentId: id } },
      });
      assertRule(
        !makeups,
        'TRANSFER_HAS_MAKEUPS',
        'Cancel pending makeup bookings before transfer',
      );
      const targetSessions = await tx.classSession.findMany({
        where: { classId: target.id, startsAt: { gte: at, lt: endExclusive }, status: 'SCHEDULED' },
      });
      const sourceSessions = await tx.classSession.findMany({
        where: {
          classId: fromClassId,
          startsAt: { gte: at, lt: endExclusive },
          status: 'SCHEDULED',
        },
      });
      assertRule(
        sourceSessions.every((s) => targetSessions.some((t) => t.lessonId === s.lessonId)),
        'TRANSFER_LESSON_GAP',
        'Target timetable must cover the remaining source lessons; resolve missing lessons first',
      );
      for (const session of targetSessions) {
        const extras = await tx.sessionParticipant.count({
          where: { sessionId: session.id, kind: 'MAKEUP', cancelled: false },
        });
        assertRule(
          (await this.reservations(tx, target.id, session.startsAt)) + extras < target.capacity,
          'TRANSFER_SESSION_FULL',
          'A target session is already full',
        );
      }
      const conflicts = await tx.sessionParticipant.count({
        where: {
          cancelled: false,
          enrollment: { studentProfileId: enrollment.studentProfileId },
          enrollmentId: { not: id },
          session: {
            OR: targetSessions.map((s) => ({
              startsAt: { lt: s.endsAt },
              endsAt: { gt: s.startsAt },
              status: { not: 'CANCELLED' as const },
            })),
          },
        },
      });
      assertRule(
        !conflicts,
        'STUDENT_SCHEDULE_CONFLICT',
        'Target timetable conflicts with another enrollment',
      );
      if (current)
        await tx.enrollmentPlacement.update({
          where: { id: current.id },
          data: { effectiveTo: at },
        });
      else
        await tx.enrollmentPlacement.create({
          data: {
            enrollmentId: id,
            classId: fromClassId,
            effectiveFrom: enrollment.activatedAt ?? enrollment.createdAt,
            effectiveTo: at,
          },
        });
      await tx.enrollmentPlacement.create({
        data: { enrollmentId: id, classId: target.id, effectiveFrom: at },
      });
      await tx.sessionParticipant.updateMany({
        where: {
          enrollmentId: id,
          kind: 'REGULAR',
          session: { startsAt: { gte: at }, status: 'SCHEDULED' },
        },
        data: { cancelled: true },
      });
      for (const session of targetSessions) {
        const day = studyDate(session.startsAt);
        const paused = await tx.leaveRequest.count({
          where: {
            enrollmentId: id,
            status: 'APPROVED',
            kind: 'PERIOD_PAUSE',
            fromDate: { lte: day },
            toDate: { gte: day },
          },
        });
        const existing = await tx.sessionParticipant.findUnique({
          where: { sessionId_enrollmentId: { sessionId: session.id, enrollmentId: id } },
        });
        assertRule(
          !existing || existing.kind === 'REGULAR' || existing.cancelled,
          'TRANSFER_MAKEUP_CONFLICT',
          'Target contains an active makeup seat; resolve that session first',
        );
        await tx.sessionParticipant.upsert({
          where: { sessionId_enrollmentId: { sessionId: session.id, enrollmentId: id } },
          create: {
            sessionId: session.id,
            enrollmentId: id,
            attendance: paused ? 'EXCUSED' : 'UNMARKED',
          },
          update: {
            kind: 'REGULAR',
            cancelled: false,
            attendance: paused ? 'EXCUSED' : 'UNMARKED',
          },
        });
      }
      const transfer = await tx.enrollmentTransfer.create({
        data: {
          enrollmentId: id,
          fromClassId,
          toClassId: target.id,
          effectiveAt: at,
          managerId: user.id,
          reason: input.reason,
        },
      });
      await this.queueFamilyEmail(
        tx,
        id,
        'ENROLLMENT_TRANSFERRED',
        transfer.id,
        `Đã chuyển lớp, hiệu lực từ ${localStudyTime(input.effectiveAt)}.`,
      );
      return transfer;
    });
  }

  async endEnrollment(user: AuthenticatedUser, id: string): Promise<unknown> {
    roles(user, 'STAFF');
    return this.repo.transaction(async (tx) => {
      const { enrollment, impact } = await this.endOne(tx, id);
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'ENROLLMENT_END',
          entityType: 'Enrollment',
          entityId: id,
          afterData: impact,
        },
      });
      await this.queueFamilyEmail(tx, id, 'ENROLLMENT_ENDED', id, 'Ghi danh đã kết thúc.');
      return { ...enrollment, impact };
    });
  }

  async endStudent(user: AuthenticatedUser, studentId: string): Promise<unknown> {
    roles(user, 'STAFF');
    return this.repo.transaction(async (tx) => {
      const enrollments = await tx.enrollment.findMany({
        where: { studentProfileId: studentId, status: { not: 'ENDED' } },
      });
      const impact = {
        enrollmentIds: [] as string[],
        pendingLeavesCancelled: 0,
        makeupsCancelled: 0,
        futureSessionsCancelled: 0,
      };
      for (const enrollment of enrollments) {
        const result = await this.endOne(tx, enrollment.id);
        await this.queueFamilyEmail(
          tx,
          enrollment.id,
          'STUDENT_STUDY_ENDED',
          `${studentId}:${enrollment.id}`,
          'Học sinh đã nghỉ học tại trung tâm.',
        );
        impact.enrollmentIds.push(enrollment.id);
        impact.pendingLeavesCancelled += result.impact.pendingLeavesCancelled;
        impact.makeupsCancelled += result.impact.makeupsCancelled;
        impact.futureSessionsCancelled += result.impact.futureSessionsCancelled;
      }
      const student = await tx.studentProfile.update({
        where: { id: studentId },
        data: { status: 'INACTIVE' },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'STUDENT_END_STUDY',
          entityType: 'StudentProfile',
          entityId: studentId,
          afterData: impact,
        },
      });
      return { ...student, impact };
    });
  }

  async reactivateStudent(
    user: AuthenticatedUser,
    studentId: string,
    input: ReactivateStudentDto,
  ): Promise<unknown> {
    roles(user, 'STAFF');
    return this.repo.transaction(async (tx) => {
      const student = await tx.studentProfile.findUnique({ where: { id: studentId } });
      assertRule(student, 'STUDENT_NOT_FOUND', 'Student not found', HttpStatus.NOT_FOUND);
      if (student.status === 'ACTIVE') return student;
      const activeEnrollments = await tx.enrollment.count({
        where: { studentProfileId: studentId, status: { not: 'ENDED' } },
      });
      assertRule(
        !activeEnrollments,
        'STUDENT_HAS_ACTIVE_ENROLLMENT',
        'Resolve active enrollments before reactivating the student',
      );
      const updated = await tx.studentProfile.update({
        where: { id: studentId },
        data: { status: 'ACTIVE' },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'STUDENT_REACTIVATE',
          entityType: 'StudentProfile',
          entityId: studentId,
          beforeData: { status: student.status },
          afterData: { status: updated.status, reason: input.reason },
        },
      });
      return updated;
    });
  }

  private async endOne(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{
    enrollment: Enrollment;
    impact: {
      pendingLeavesCancelled: number;
      makeupsCancelled: number;
      futureSessionsCancelled: number;
    };
  }> {
    const now = new Date();
    const enrollment = await tx.enrollment.findUniqueOrThrow({ where: { id } });
    const cancelledLeaves = await tx.leaveRequest.updateMany({
      where: { enrollmentId: id, status: 'PENDING' },
      data: { status: 'CANCELLED', decisionNote: 'Enrollment ended' },
    });
    await tx.enrollmentPlacement.updateMany({
      where: {
        enrollmentId: id,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      data: { effectiveTo: now },
    });
    const futurePlacements = await tx.enrollmentPlacement.findMany({
      where: { enrollmentId: id, effectiveFrom: { gt: now } },
    });
    for (const placement of futurePlacements) {
      await tx.enrollmentPlacement.update({
        where: { id: placement.id },
        data: { effectiveTo: placement.effectiveFrom },
      });
    }
    const bookings = await tx.makeupBooking.findMany({
      where: { status: 'BOOKED', original: { enrollmentId: id } },
    });
    await tx.sessionParticipant.updateMany({
      where: { id: { in: bookings.map((b) => b.replacementParticipantId) } },
      data: { cancelled: true },
    });
    await tx.makeupBooking.updateMany({
      where: { id: { in: bookings.map((b) => b.id) } },
      data: { status: 'CANCELLED', activeOriginalId: null },
    });
    const cancelledSessions = await tx.sessionParticipant.updateMany({
      where: { enrollmentId: id, cancelled: false, session: { startsAt: { gt: now } } },
      data: { cancelled: true },
    });
    await tx.linkInvitation.updateMany({
      where: { registrationOrderId: enrollment.registrationOrderId, status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    });
    return {
      enrollment: await tx.enrollment.update({
        where: { id },
        data: { status: 'ENDED', endedAt: now },
      }),
      impact: {
        pendingLeavesCancelled: cancelledLeaves.count,
        makeupsCancelled: bookings.length,
        futureSessionsCancelled: cancelledSessions.count,
      },
    };
  }

  private async reservations(
    tx: Prisma.TransactionClient,
    classId: string,
    at: Date,
  ): Promise<number> {
    const day = studyDate(at);
    return tx.enrollment.count({
      where: {
        status: { in: ['ACTIVE', 'PENDING_LINK'] },
        OR: [{ endDate: null }, { endDate: { gt: day } }],
        AND: [
          { OR: [{ startDate: null }, { startDate: { lte: day } }] },
          {
            OR: [
              {
                placements: {
                  some: {
                    classId,
                    effectiveFrom: { lte: at },
                    OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
                  },
                },
              },
              { placements: { none: {} }, classId },
            ],
          },
        ],
      },
    });
  }
}
