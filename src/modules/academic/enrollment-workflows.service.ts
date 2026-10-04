import { Injectable } from '@nestjs/common';
import type { Enrollment, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import {
  AcademicAccessService,
  assertRule,
  inTerm,
  roles,
  studyDate,
} from './academic-access.service';
import { AcademicRepository } from './academic.repository';
import {
  AttendanceDto,
  DecisionDto,
  LeaveDto,
  LeaveFilterDto,
  MakeupDto,
  MakeupSourceFilterDto,
  PageDto,
  TransferDto,
} from './academic.dto';

@Injectable()
export class EnrollmentWorkflowsService {
  constructor(
    private readonly repo: AcademicRepository,
    private readonly access: AcademicAccessService,
  ) {}

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
    await this.access.enrollment(user, input.enrollmentId);
    const from = new Date(input.fromDate),
      to = new Date(input.toDate);
    assertRule(
      /^\d{4}-\d{2}-\d{2}$/.test(input.fromDate) && /^\d{4}-\d{2}-\d{2}$/.test(input.toDate),
      'INVALID_DATE',
      'Use YYYY-MM-DD dates',
    );
    assertRule(from <= to, 'INVALID_DATE_RANGE', 'Start must not follow end');
    const enrollment = await this.repo.db.enrollment.findUniqueOrThrow({
      where: { id: input.enrollmentId },
    });
    assertRule(
      enrollment.status === 'ACTIVE' &&
        enrollment.startDate &&
        enrollment.endDate &&
        from >= enrollment.startDate &&
        to < enrollment.endDate,
      'OUTSIDE_ENROLLMENT',
      'Leave must fall inside active enrollment',
    );
    assertRule(
      (input.kind === 'SINGLE_ABSENCE') === !!input.sessionId,
      'INVALID_LEAVE',
      'Single absence requires a session; period pause must omit it',
    );
    if (input.sessionId) {
      const participant = await this.repo.db.sessionParticipant.findUnique({
        where: {
          sessionId_enrollmentId: { sessionId: input.sessionId, enrollmentId: input.enrollmentId },
        },
        include: { session: true },
      });
      assertRule(
        participant &&
          !participant.cancelled &&
          participant.kind === 'REGULAR' &&
          participant.session.status === 'SCHEDULED',
        'INVALID_SESSION',
        'Select a scheduled regular session',
      );
      assertRule(
        from.getTime() === studyDate(participant.session.startsAt).getTime() &&
          from.getTime() === to.getTime(),
        'INVALID_LEAVE_DATE',
        'Single absence must match the session date',
      );
    }
    const data = { ...input, fromDate: from, toDate: to, requestedById: user.id };
    if (user.role !== 'STAFF') return this.repo.db.leaveRequest.create({ data });
    // Staff record leave on behalf of the parent (SRS 6.4/6.7), so it is approved in the same step.
    return this.repo.transaction(async (tx) => {
      const leave = await tx.leaveRequest.create({ data });
      return this.decideLeave(user, leave.id, { approve: true, reason: input.reason }, tx);
    });
  }

  async decideLeave(
    user: AuthenticatedUser,
    id: string,
    input: DecisionDto,
    outer?: Prisma.TransactionClient,
  ): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF');
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
            replacementBooking: true,
            sourceBookings: { where: { status: 'BOOKED' } },
          },
        });
        assertRule(
          rows.every(
            (r) =>
              r.session.status === 'SCHEDULED' && !r.replacementBooking && !r.sourceBookings.length,
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
      return tx.leaveRequest.update({
        where: { id },
        data: {
          status: input.approve ? 'APPROVED' : 'REJECTED',
          decidedById: user.id,
          decisionNote: input.reason,
        },
      });
    };
    return outer ? run(outer) : this.repo.transaction(run);
  }

  async cancelLeave(user: AuthenticatedUser, id: string): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF');
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
      return tx.leaveRequest.update({
        where: { id },
        data: { status: 'CANCELLED', decidedById: user.id },
      });
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
    const original = await this.repo.db.sessionParticipant.findUniqueOrThrow({
      where: { id: participantId },
      include: { session: true },
    });
    return this.repo.db.classSession.findMany({
      where: {
        id: { not: original.sessionId },
        lessonId: original.session.lessonId,
        startsAt: { gt: new Date() },
        status: 'SCHEDULED',
      },
      include: {
        class: { select: { name: true, capacity: true } },
        _count: {
          select: { participants: { where: { cancelled: false, attendance: { not: 'EXCUSED' } } } },
        },
      },
      take: page.limit,
      skip: (page.page - 1) * page.limit,
      orderBy: { startsAt: 'asc' },
    });
  }

  async bookMakeup(user: AuthenticatedUser, input: MakeupDto): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF');
    return this.repo.transaction(async (tx) => {
      const source = await tx.sessionParticipant.findUniqueOrThrow({
        where: { id: input.originalParticipantId },
        include: { session: true, enrollment: true },
      });
      const target = await tx.classSession.findUniqueOrThrow({
        where: { id: input.targetSessionId },
        include: { class: true },
      });
      assertRule(
        !source.cancelled &&
          source.kind === 'REGULAR' &&
          source.attendance !== 'PRESENT' &&
          source.attendance !== 'EXCUSED',
        'INVALID_MAKEUP_SOURCE',
        'Only a missed or planned-absence regular session can be made up',
      );
      assertRule(
        source.session.status !== 'CANCELLED' &&
          target.id !== source.sessionId &&
          target.lessonId === source.session.lessonId &&
          target.status === 'SCHEDULED' &&
          target.startsAt > new Date(),
        'INVALID_MAKEUP_TARGET',
        'Target must be a future session of the same lesson',
      );
      assertRule(
        inTerm(source.enrollment, target.startsAt),
        'OUTSIDE_ENROLLMENT',
        'Makeup is outside the active term',
      );
      if (source.session.status !== 'COMPLETED') {
        const leave = await tx.leaveRequest.count({
          where: {
            enrollmentId: source.enrollmentId,
            sessionId: source.sessionId,
            status: 'APPROVED',
            kind: 'SINGLE_ABSENCE',
          },
        });
        assertRule(
          leave,
          'ABSENCE_NOT_APPROVED',
          'Approve a single-session absence before a planned swap',
        );
      }
      const day = studyDate(target.startsAt);
      const leave = await tx.leaveRequest.count({
        where: {
          enrollmentId: source.enrollmentId,
          status: 'APPROVED',
          fromDate: { lte: day },
          toDate: { gte: day },
        },
      });
      assertRule(!leave, 'TARGET_DURING_LEAVE', 'Target conflicts with approved leave');
      const conflict = await tx.sessionParticipant.count({
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
      });
      assertRule(
        !conflict,
        'STUDENT_SCHEDULE_CONFLICT',
        'Student already has a session at this time',
      );
      const regularReservations = await this.reservations(tx, target.classId, target.startsAt);
      const extra = await tx.sessionParticipant.count({
        where: { sessionId: target.id, cancelled: false, kind: 'MAKEUP' },
      });
      assertRule(
        regularReservations + extra < target.class.capacity,
        'SESSION_FULL',
        'Target session has no remaining seats',
      );
      const replacement = await tx.sessionParticipant.create({
        data: { sessionId: target.id, enrollmentId: source.enrollmentId, kind: 'MAKEUP' },
      });
      return tx.makeupBooking.create({
        data: {
          originalParticipantId: source.id,
          activeOriginalId: source.id,
          replacementParticipantId: replacement.id,
          managerId: user.id,
        },
      });
    });
  }

  async cancelMakeup(user: AuthenticatedUser, id: string): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF');
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
      return tx.makeupBooking.update({
        where: { id },
        data: { status: 'CANCELLED', activeOriginalId: null },
      });
    });
  }

  async finalizeAttendance(
    user: AuthenticatedUser,
    id: string,
    input: AttendanceDto,
  ): Promise<unknown> {
    await this.access.session(user, id);
    return this.repo.transaction(async (tx) => {
      const session = await tx.classSession.findUniqueOrThrow({
        where: { id },
        include: {
          participants: {
            where: { cancelled: false },
            include: {
              replacementBooking: true,
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
        if (row.replacementBooking)
          await tx.makeupBooking.update({
            where: { id: row.replacementBooking.id },
            data: {
              status: item.status === 'PRESENT' ? 'COMPLETED' : 'MISSED',
              activeOriginalId:
                item.status === 'PRESENT' ? row.replacementBooking.originalParticipantId : null,
            },
          });
      }
      return tx.classSession.update({
        where: { id },
        data: { status: 'COMPLETED', summary: input.summary },
      });
    });
  }

  async transfer(user: AuthenticatedUser, id: string, input: TransferDto): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF');
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
          !existing || existing.kind === 'REGULAR',
          'TRANSFER_MAKEUP_CONFLICT',
          'Target contains a previous makeup seat; resolve that session first',
        );
        await tx.sessionParticipant.upsert({
          where: { sessionId_enrollmentId: { sessionId: session.id, enrollmentId: id } },
          create: {
            sessionId: session.id,
            enrollmentId: id,
            attendance: paused ? 'EXCUSED' : 'UNMARKED',
          },
          update: { cancelled: false, attendance: paused ? 'EXCUSED' : 'UNMARKED' },
        });
      }
      return tx.enrollmentTransfer.create({
        data: {
          enrollmentId: id,
          fromClassId,
          toClassId: target.id,
          effectiveAt: at,
          managerId: user.id,
          reason: input.reason,
        },
      });
    });
  }

  async endEnrollment(user: AuthenticatedUser, id: string): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF');
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
      return { ...enrollment, impact };
    });
  }

  async endStudent(user: AuthenticatedUser, studentId: string): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF');
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
