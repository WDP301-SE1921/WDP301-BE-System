import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type ClassWeeklySchedule } from '@prisma/client';
import { createHash } from 'node:crypto';

import { AppError } from '../../common/errors/app.error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { DatabaseService } from '../../database/orm/database.service';
import {
  ClassDto,
  ClassFilterDto,
  CreateRegistrationDto,
  CreateStudentDto,
  PageDto,
  ListPaymentsDto,
  ListRegistrationsDto,
  ListStudentsDto,
  ParentSearchDto,
  ParentSuggestionDto,
  ProgramDto,
  ReplaceClassSchedulesDto,
  UpdateClassDto,
  UpdateProgramDto,
  UpdateStudentDto,
} from './dto/registration-flow.dto';

const HCM_OFFSET_MS = 7 * 3_600_000;

@Injectable()
export class RegistrationFlowService {
  constructor(private readonly db: DatabaseService) {}

  async listMyStudents(user: AuthenticatedUser): Promise<unknown> {
    this.requireRoles(user, 'PARENT');
    const profile = await this.parentProfileForUser(user.id);
    return this.db.studentProfile.findMany({
      where: { parentProfileId: profile.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createMyStudent(user: AuthenticatedUser, input: CreateStudentDto): Promise<unknown> {
    this.requireRoles(user, 'PARENT');
    this.assertVerifiedParent(user);
    const profile = await this.parentProfileForUser(user.id);
    return this.db.studentProfile.create({
      data: {
        parentProfileId: profile.id,
        fullName: input.fullName.trim(),
        grade: input.grade,
        dateOfBirth: input.dateOfBirth ? localDate(input.dateOfBirth) : undefined,
      },
    });
  }

  async updateMyStudent(
    user: AuthenticatedUser,
    id: string,
    input: UpdateStudentDto,
  ): Promise<unknown> {
    this.requireRoles(user, 'PARENT');
    this.assertVerifiedParent(user);
    return this.transaction(async (tx) => {
      const student = await tx.studentProfile.findUnique({
        where: { id },
        include: { parentProfile: true },
      });
      this.assert(student, 'STUDENT_NOT_FOUND', 'Student profile not found', HttpStatus.NOT_FOUND);
      this.assert(
        student.parentProfile.userId === user.id,
        'FORBIDDEN',
        'Student profile does not belong to this parent',
        HttpStatus.FORBIDDEN,
      );
      if (input.grade !== undefined && input.grade !== student.grade) {
        const currentOrFuture = await tx.enrollment.count({
          where: {
            studentProfileId: id,
            status: 'ACTIVE',
            OR: [{ endDate: null }, { endDate: { gt: todayLocalDate() } }],
          },
        });
        this.assert(
          !currentOrFuture,
          'STUDENT_GRADE_LOCKED',
          'Cannot change grade while the student has current or future enrollments',
        );
      }
      return tx.studentProfile.update({
        where: { id },
        data: {
          ...(input.fullName === undefined ? {} : { fullName: input.fullName.trim() }),
          ...(input.grade === undefined ? {} : { grade: input.grade }),
          ...(input.dateOfBirth === undefined
            ? {}
            : { dateOfBirth: input.dateOfBirth ? localDate(input.dateOfBirth) : null }),
        },
      });
    });
  }

  async lookupParent(user: AuthenticatedUser, email: string): Promise<unknown> {
    this.requireRoles(user, 'STAFF', 'MANAGER');
    const normalizedEmail = email.trim().toLowerCase();
    const parent = await this.db.user.findFirst({
      where: { email: normalizedEmail, role: 'PARENT' },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        emailVerifiedAt: true,
        parentProfile: {
          select: {
            id: true,
            phone: true,
            students: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    this.assert(parent, 'PARENT_NOT_FOUND', 'Parent account not found', HttpStatus.NOT_FOUND);
    return parent;
  }

  async createProgram(user: AuthenticatedUser, input: ProgramDto): Promise<unknown> {
    this.requireRoles(user, 'MANAGER');
    return this.db.program.create({ data: normalizeProgram(input) });
  }

  async searchParents(
    user: AuthenticatedUser,
    query: ParentSearchDto,
  ): Promise<ParentSuggestionDto[]> {
    this.requireRoles(user, 'STAFF');
    const email = query.email.trim().toLowerCase();
    // LOCATE matches literal email characters, including % and _, rather than LIKE wildcards.
    // Tagged parameters are bound by Prisma; the schema uses utf8mb4_unicode_ci for email.
    return this.db.$queryRaw<ParentSuggestionDto[]>`
      SELECT id, email, displayName, status
      FROM users
      WHERE role = 'PARENT' AND LOCATE(${email}, LOWER(email)) > 0
      ORDER BY email ASC
      LIMIT ${query.limit}
    `;
  }

  async listPrograms(user: AuthenticatedUser, page: PageDto): Promise<unknown> {
    this.requireRoles(user, 'STAFF', 'MANAGER', 'TEACHER', 'CURRICULUM_DESIGNER');
    return this.db.program.findMany({
      orderBy: [{ grade: 'asc' }, { subject: 'asc' }],
      skip: (page.page - 1) * page.limit,
      take: page.limit,
    });
  }

  async createClass(user: AuthenticatedUser, input: ClassDto): Promise<unknown> {
    this.requireRoles(user, 'MANAGER');
    this.assert(
      input.isOpen !== true,
      'CLASS_NEEDS_SCHEDULE',
      'Create schedules before opening registration for a class',
    );
    await this.assertTeacher(input.teacherId);
    return this.db.class.create({
      data: {
        programId: input.programId,
        name: input.name.trim(),
        teacherId: input.teacherId,
        capacity: input.capacity,
        monthlyFee: input.monthlyFee,
        isOpen: false,
      },
      include: { program: true, weeklySchedules: true },
    });
  }

  async updateClass(user: AuthenticatedUser, id: string, input: UpdateClassDto): Promise<unknown> {
    this.requireRoles(user, 'MANAGER');
    await this.assertTeacher(input.teacherId ?? undefined);
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM classes WHERE id = ${id} FOR UPDATE`;
      const classroom = await tx.class.findUnique({
        where: { id },
        include: { weeklySchedules: true },
      });
      this.assert(classroom, 'CLASS_NOT_FOUND', 'Class not found', HttpStatus.NOT_FOUND);
      if (input.teacherId !== undefined && input.teacherId !== classroom.teacherId) {
        const scheduled = await tx.classSession.count({
          where: { classId: id, status: 'SCHEDULED', startsAt: { gte: new Date() } },
        });
        this.assert(
          !scheduled,
          'CLASS_TEACHER_LOCKED',
          'Cannot change teacher while future sessions are scheduled',
        );
      }
      if (input.isOpen === true) {
        this.assert(
          classroom.weeklySchedules.length > 0,
          'CLASS_NEEDS_SCHEDULE',
          'Class must have at least one weekly schedule before opening registration',
        );
      }
      return tx.class.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name.trim() }),
          ...(input.teacherId === undefined ? {} : { teacherId: input.teacherId }),
          ...(input.capacity === undefined ? {} : { capacity: input.capacity }),
          ...(input.monthlyFee === undefined ? {} : { monthlyFee: input.monthlyFee }),
          ...(input.isOpen === undefined ? {} : { isOpen: input.isOpen }),
        },
        include: { program: true, weeklySchedules: true },
      });
    });
  }

  async listClasses(user: AuthenticatedUser, input: ClassFilterDto): Promise<unknown> {
    this.requireRoles(user, 'STAFF', 'MANAGER', 'TEACHER', 'PARENT');
    this.assert(
      !input.startDate === !input.packageMonths,
      'VALIDATION_ERROR',
      'startDate and packageMonths must be provided together',
      HttpStatus.BAD_REQUEST,
    );
    const student =
      input.studentId && user.role !== 'TEACHER'
        ? await this.findVisibleStudent(user, input.studentId)
        : null;
    const programWhere: Prisma.ProgramWhereInput = {
      ...(student ? { grade: student.grade } : {}),
      ...(input.subject ? { subject: input.subject.trim() } : {}),
    };
    const rows = await this.db.class.findMany({
      where: {
        ...(user.role === 'TEACHER' ? { teacherId: user.id } : {}),
        ...(Object.keys(programWhere).length ? { program: programWhere } : {}),
      },
      include: { program: true, weeklySchedules: true, _count: { select: { enrollments: true } } },
      orderBy: [{ isOpen: 'desc' }, { name: 'asc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    });
    if (!input.startDate || !input.packageMonths || user.role === 'TEACHER') return rows;
    const startDate = localDate(input.startDate);
    const endDate = addCalendarMonths(startDate, input.packageMonths);
    const termWhere = {
      status: 'ACTIVE' as const,
      startDate: { lt: endDate },
      endDate: { gt: startDate },
    };
    const [classEnrollments, studentRecord] = await Promise.all([
      this.db.enrollment.findMany({
        where: { ...termWhere, classId: { in: rows.map((row) => row.id) } },
        select: { classId: true, startDate: true, endDate: true },
      }),
      student ? this.loadStudentForRegistration(this.db, student.id) : null,
    ]);
    const studentEnrollments = student
      ? await this.studentTermEnrollments(this.db, student.id, startDate, endDate)
      : [];
    return rows.map((row) => {
      const occupied = classEnrollments.filter((item) => item.classId === row.id);
      const availableSeats = Math.max(
        0,
        row.capacity - peakOccupancy(occupied, startDate, endDate),
      );
      const problem = registrationProblem({
        student: studentRecord,
        classroom: row,
        startDate,
        endDate,
        classEnrollments: occupied,
        studentEnrollments,
      });
      return {
        ...row,
        availableSeats,
        isEligible: !problem,
        ineligibleReason: problem?.code ?? null,
        ineligibleMessage: problem?.message ?? null,
      };
    });
  }

  async replaceClassSchedules(
    user: AuthenticatedUser,
    classId: string,
    input: ReplaceClassSchedulesDto,
  ): Promise<unknown> {
    this.requireRoles(user, 'MANAGER');
    const schedules = input.schedules.map((item) => ({
      weekday: item.weekday,
      startTime: item.startTime,
      endTime: item.endTime,
    }));
    for (const schedule of schedules) {
      this.assert(
        timeToMinutes(schedule.startTime) < timeToMinutes(schedule.endTime),
        'INVALID_SCHEDULE_TIME',
        'Schedule start time must be before end time',
      );
    }
    this.assertNoScheduleOverlaps(schedules);
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM classes WHERE id = ${classId} FOR UPDATE`;
      const active = await tx.enrollment.count({
        where: { classId, status: { not: 'ENDED' } },
      });
      this.assert(
        !active,
        'CLASS_SCHEDULE_LOCKED',
        'Cannot change schedule while class has enrollments',
      );
      const futureSessions = await tx.classSession.count({
        where: { classId, status: 'SCHEDULED', startsAt: { gte: new Date() } },
      });
      this.assert(
        !futureSessions,
        'CLASS_SCHEDULE_LOCKED',
        'Cannot change schedule while future sessions exist',
      );
      await tx.class.findUniqueOrThrow({ where: { id: classId } });
      await tx.classWeeklySchedule.deleteMany({ where: { classId } });
      await tx.classWeeklySchedule.createMany({
        data: schedules.map((schedule) => ({ ...schedule, classId })),
      });
      return tx.class.findUniqueOrThrow({
        where: { id: classId },
        include: {
          program: true,
          weeklySchedules: { orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] },
        },
      });
    });
  }

  async createRegistration(
    user: AuthenticatedUser,
    input: CreateRegistrationDto,
    idempotencyKey?: string,
  ): Promise<unknown> {
    this.requireRoles(user, 'STAFF');
    const key = idempotencyKey?.trim() || null;
    this.assert(
      !key || key.length <= 191,
      'VALIDATION_ERROR',
      'Idempotency-Key must be at most 191 characters',
      HttpStatus.BAD_REQUEST,
    );
    const startDate = localDate(input.startDate);
    const endDate = addCalendarMonths(startDate, input.packageMonths);
    const requestHash = hashRequest({
      targetStudentId: input.targetStudentId,
      classId: input.classId,
      startDate: input.startDate.slice(0, 10),
      packageMonths: input.packageMonths,
    });
    if (key) {
      const replay = await this.findDraftByKey(user.id, key, requestHash);
      if (replay) return replay;
    }
    this.assert(
      startDate >= todayLocalDate(),
      'INVALID_START_DATE',
      'Start date must be today or a future date',
    );
    try {
      return await this.transaction(async (tx) => {
        const [student, classroom] = await Promise.all([
          this.loadStudentForRegistration(tx, input.targetStudentId),
          tx.class.findUnique({
            where: { id: input.classId },
            include: { program: true, weeklySchedules: true },
          }),
        ]);
        this.assert(
          student,
          'STUDENT_NOT_FOUND',
          'Student profile not found',
          HttpStatus.NOT_FOUND,
        );
        this.assert(classroom, 'CLASS_NOT_FOUND', 'Class not found', HttpStatus.NOT_FOUND);
        await this.assertRegistrationAllowed(tx, student, classroom, startDate, endDate);
        const quotedAmount = new Prisma.Decimal(classroom.monthlyFee).mul(input.packageMonths);
        return tx.registrationOrder.create({
          data: {
            type: 'EXISTING_STUDENT_NEW_SUBJECT',
            parentEmail: student.parentProfile.user.email,
            parentPhone: student.parentProfile.phone,
            studentFullName: student.fullName,
            studentGrade: student.grade,
            targetStudentId: student.id,
            classId: classroom.id,
            packageMonths: input.packageMonths,
            quotedAmount,
            billSnapshot: {
              parent: {
                displayName: student.parentProfile.user.displayName,
                email: student.parentProfile.user.email,
                phone: student.parentProfile.phone,
              },
              student: { id: student.id, fullName: student.fullName, grade: student.grade },
              class: {
                id: classroom.id,
                name: classroom.name,
                subject: classroom.program.subject,
                grade: classroom.program.grade,
                schedules: classroom.weeklySchedules.map((slot) => ({
                  weekday: slot.weekday,
                  startTime: slot.startTime,
                  endTime: slot.endTime,
                })),
              },
              monthlyFee: classroom.monthlyFee.toString(),
            },
            startDate,
            endDate,
            status: 'DRAFT',
            createdByManagerId: user.id,
            createIdempotencyKey: key,
            createRequestHash: key ? requestHash : null,
          },
          include: registrationInclude,
        });
      });
    } catch (error) {
      // A concurrent request with the same key committed first: return its draft.
      if (key && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.findDraftByKey(user.id, key, requestHash);
        if (replay) return replay;
      }
      throw error;
    }
  }

  private async findDraftByKey(
    actorId: string,
    key: string,
    requestHash: string,
  ): Promise<unknown> {
    const existing = await this.db.registrationOrder.findUnique({
      where: {
        createdByManagerId_createIdempotencyKey: {
          createdByManagerId: actorId,
          createIdempotencyKey: key,
        },
      },
      include: registrationInclude,
    });
    if (!existing) return null;
    this.assert(
      existing.createRequestHash === requestHash,
      'IDEMPOTENCY_KEY_CONFLICT',
      'Idempotency-Key was already used with a different request',
    );
    return existing;
  }

  async listRegistrations(user: AuthenticatedUser, query: ListRegistrationsDto): Promise<unknown> {
    this.requireRoles(user, 'STAFF', 'MANAGER');
    const search = query.search?.trim();
    const where: Prisma.RegistrationOrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.createdBy === 'me' ? { createdByManagerId: user.id } : {}),
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.fromDate || query.toDate
        ? {
            createdAt: {
              ...(query.fromDate ? { gte: atStartOfLocalDay(localDate(query.fromDate)) } : {}),
              ...(query.toDate
                ? { lt: atStartOfLocalDay(addDays(localDate(query.toDate), 1)) }
                : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { parentEmail: { contains: search } },
              { studentFullName: { contains: search } },
              { payment: { receiptNumber: { contains: search } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.registrationOrder.findMany({
        where,
        include: registrationInclude,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.registrationOrder.count({ where }),
    ]);
    return { items, page: query.page, limit: query.limit, total };
  }

  async listPayments(user: AuthenticatedUser, query: ListPaymentsDto): Promise<unknown> {
    this.requireRoles(user, 'STAFF', 'MANAGER');
    const search = query.search?.trim();
    const where: Prisma.PaymentWhereInput = {
      ...(query.fromDate || query.toDate
        ? {
            confirmedAt: {
              ...(query.fromDate ? { gte: atStartOfLocalDay(localDate(query.fromDate)) } : {}),
              ...(query.toDate
                ? { lt: atStartOfLocalDay(addDays(localDate(query.toDate), 1)) }
                : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { receiptNumber: { contains: search } },
              { registrationOrder: { parentEmail: { contains: search } } },
              { registrationOrder: { studentFullName: { contains: search } } },
            ],
          }
        : {}),
    };
    const [items, total, aggregate] = await Promise.all([
      this.db.payment.findMany({
        where,
        include: {
          confirmedByManager: { select: { id: true, displayName: true, email: true } },
          registrationOrder: {
            select: {
              id: true,
              parentEmail: true,
              studentFullName: true,
              studentGrade: true,
              packageMonths: true,
              startDate: true,
              endDate: true,
              class: { select: { id: true, name: true, program: true } },
            },
          },
        },
        orderBy: { confirmedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.payment.count({ where }),
      this.db.payment.aggregate({ where, _sum: { amount: true } }),
    ]);
    return {
      items,
      page: query.page,
      limit: query.limit,
      total,
      totalAmount: (aggregate._sum.amount ?? new Prisma.Decimal(0)).toString(),
    };
  }

  async registration(user: AuthenticatedUser, id: string): Promise<unknown> {
    this.requireRoles(user, 'STAFF', 'PARENT');
    const order = await this.db.registrationOrder.findUnique({
      where: { id },
      include: registrationInclude,
    });
    this.assert(order, 'REGISTRATION_NOT_FOUND', 'Registration not found', HttpStatus.NOT_FOUND);
    this.assertCanReadRegistration(user, order.parentEmail);
    return order;
  }

  async myBills(user: AuthenticatedUser, page: PageDto): Promise<unknown> {
    this.requireRoles(user, 'PARENT');
    const where: Prisma.RegistrationOrderWhereInput = {
      targetStudent: { is: { parentProfile: { is: { userId: user.id } } } },
    };
    const [orders, total] = await Promise.all([
      this.db.registrationOrder.findMany({
        where,
        include: billInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page.page - 1) * page.limit,
        take: page.limit,
      }),
      this.db.registrationOrder.count({ where }),
    ]);
    return { items: orders.map(billResponse), page: page.page, limit: page.limit, total };
  }

  async bill(user: AuthenticatedUser, id: string): Promise<unknown> {
    this.requireRoles(user, 'STAFF', 'PARENT');
    const order = await this.db.registrationOrder.findUnique({
      where: { id },
      include: billInclude,
    });
    this.assert(order, 'BILL_NOT_FOUND', 'Bill not found', HttpStatus.NOT_FOUND);
    if (user.role === 'PARENT') {
      this.assert(
        order.targetStudent?.parentProfile.userId === user.id,
        'FORBIDDEN',
        'Bill does not belong to this parent',
        HttpStatus.FORBIDDEN,
      );
    }
    return billResponse(order);
  }

  async cancelRegistration(user: AuthenticatedUser, id: string): Promise<unknown> {
    this.requireRoles(user, 'STAFF');
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM registration_orders WHERE id = ${id} FOR UPDATE`;
      const order = await tx.registrationOrder.findUnique({
        where: { id },
        include: registrationInclude,
      });
      this.assert(order, 'REGISTRATION_NOT_FOUND', 'Registration not found', HttpStatus.NOT_FOUND);
      if (order.status === 'CANCELLED') return order;
      this.assert(
        order.status === 'DRAFT',
        'REGISTRATION_NOT_DRAFT',
        'Only draft registrations can be cancelled',
      );
      const cancelled = await tx.registrationOrder.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: registrationInclude,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'REGISTRATION_CANCEL_DRAFT',
          entityType: 'RegistrationOrder',
          entityId: id,
        },
      });
      return cancelled;
    });
  }

  async confirmPayment(
    user: AuthenticatedUser,
    id: string,
    idempotencyKey: string | undefined,
    receiptNumber?: string,
  ): Promise<unknown> {
    this.requireRoles(user, 'STAFF');
    this.assert(idempotencyKey, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    const scope = `confirm-payment:${id}`;
    const requestHash = hashRequest({
      registrationId: id,
      receiptNumber: receiptNumber?.trim() ?? null,
    });
    const replayOf = (
      record: { actorUserId: string | null; requestHash: string | null; response: unknown } | null,
    ): unknown => {
      if (!record) return undefined;
      // Rows written before actor/body binding have no hash and replay as before.
      this.assert(
        (!record.actorUserId || record.actorUserId === user.id) &&
          (!record.requestHash || record.requestHash === requestHash),
        'IDEMPOTENCY_KEY_CONFLICT',
        'Idempotency-Key was already used with a different actor or request body',
      );
      return record.response;
    };
    const existing = replayOf(
      await this.db.idempotencyRecord.findUnique({
        where: { scope_key: { scope, key: idempotencyKey } },
      }),
    );
    if (existing !== undefined) return existing;
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM registration_orders WHERE id = ${id} FOR UPDATE`;
      const order = await tx.registrationOrder.findUnique({
        where: { id },
        include: {
          targetStudent: { include: { parentProfile: { include: { user: true } } } },
          class: { include: { program: true, weeklySchedules: true } },
          payment: true,
          enrollment: true,
        },
      });
      this.assert(order, 'REGISTRATION_NOT_FOUND', 'Registration not found', HttpStatus.NOT_FOUND);
      // A concurrent request with the same key may have committed while this one waited for the lock.
      const committed = replayOf(
        await tx.idempotencyRecord.findUnique({
          where: { scope_key: { scope, key: idempotencyKey } },
        }),
      );
      if (committed !== undefined) return committed;
      this.assert(
        order.status === 'DRAFT',
        'REGISTRATION_NOT_DRAFT',
        'Only draft registrations can be confirmed; a completed or cancelled registration cannot take a new key',
      );
      this.assert(
        order.targetStudent && order.startDate && order.endDate,
        'INVALID_REGISTRATION',
        'Registration is missing student or term data',
      );
      this.assert(
        order.startDate >= todayLocalDate(),
        'INVALID_START_DATE',
        'Draft start date has passed; cancel it and create a new registration',
      );
      await tx.$queryRaw`SELECT id FROM student_profiles WHERE id = ${order.targetStudentId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM classes WHERE id = ${order.classId} FOR UPDATE`;
      const billSnapshot = order.billSnapshot as BillSnapshot | null;
      this.assert(
        !billSnapshot || billClassMatches(billSnapshot.class, order.class),
        'BILL_CLASS_CHANGED',
        'Class details changed after bill creation; cancel and recreate the registration',
      );
      await this.assertRegistrationAllowed(
        tx,
        order.targetStudent,
        order.class,
        order.startDate,
        order.endDate,
      );
      const payment = await tx.payment.create({
        data: {
          registrationOrderId: order.id,
          amount: order.quotedAmount,
          currency: order.currency,
          confirmedByManagerId: user.id,
          receiptNumber: receiptNumber?.trim() || receiptNo(order.id),
        },
      });
      const enrollment = await tx.enrollment.create({
        data: {
          registrationOrderId: order.id,
          studentProfileId: order.targetStudent.id,
          classId: order.classId,
          packageMonths: order.packageMonths,
          status: 'ACTIVE',
          startDate: order.startDate,
          endDate: order.endDate,
          activatedAt: new Date(),
        },
      });
      await tx.enrollmentPlacement.create({
        data: {
          enrollmentId: enrollment.id,
          classId: order.classId,
          effectiveFrom: atStartOfLocalDay(order.startDate),
        },
      });
      const completed = await tx.registrationOrder.update({
        where: { id: order.id },
        data: { status: 'COMPLETED', confirmedAt: new Date(), linkedAt: new Date() },
        include: registrationInclude,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'REGISTRATION_CONFIRM_PAYMENT',
          entityType: 'RegistrationOrder',
          entityId: order.id,
          afterData: { paymentId: payment.id, enrollmentId: enrollment.id },
        },
      });
      const response = receiptResponse(completed);
      await tx.idempotencyRecord.create({
        data: {
          scope,
          key: idempotencyKey,
          registrationOrderId: id,
          actorUserId: user.id,
          requestHash,
          response: response as Prisma.InputJsonObject,
        },
      });
      return response;
    });
  }

  async receipt(user: AuthenticatedUser, id: string): Promise<unknown> {
    this.requireRoles(user, 'STAFF', 'PARENT');
    const order = await this.db.registrationOrder.findUnique({
      where: { id },
      include: registrationInclude,
    });
    this.assert(order?.payment, 'RECEIPT_NOT_FOUND', 'Receipt not found', HttpStatus.NOT_FOUND);
    this.assertCanReadRegistration(user, order.parentEmail);
    return receiptResponse(order);
  }

  async myStudentEnrollments(user: AuthenticatedUser, studentId: string): Promise<unknown> {
    this.requireRoles(user, 'PARENT');
    await this.findVisibleStudent(user, studentId);
    return this.enrollmentsOf(studentId);
  }

  async myStudentSchedule(user: AuthenticatedUser, studentId: string): Promise<unknown> {
    this.requireRoles(user, 'PARENT');
    await this.findVisibleStudent(user, studentId);
    return scheduleOf(await this.enrollmentsOf(studentId));
  }

  async listStudents(user: AuthenticatedUser, query: ListStudentsDto): Promise<unknown> {
    this.requireRoles(user, 'STAFF', 'MANAGER');
    const search = query.search?.trim();
    const where: Prisma.StudentProfileWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.grade ? { grade: query.grade } : {}),
      ...(query.parentUserId ? { parentProfile: { userId: query.parentUserId } } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search } },
              { parentProfile: { user: { email: { contains: search } } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.studentProfile.findMany({
        where,
        include: {
          parentProfile: {
            select: {
              phone: true,
              user: { select: { id: true, email: true, displayName: true } },
            },
          },
        },
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.studentProfile.count({ where }),
    ]);
    return { items, page: query.page, limit: query.limit, total };
  }

  async studentEnrollments(user: AuthenticatedUser, studentId: string): Promise<unknown> {
    this.requireRoles(user, 'STAFF', 'MANAGER');
    await this.findVisibleStudent(user, studentId);
    return this.enrollmentsOf(studentId);
  }

  async studentSchedule(user: AuthenticatedUser, studentId: string): Promise<unknown> {
    this.requireRoles(user, 'STAFF', 'MANAGER');
    await this.findVisibleStudent(user, studentId);
    return scheduleOf(await this.enrollmentsOf(studentId));
  }

  private enrollmentsOf(studentId: string): Promise<EnrollmentWithPlacements[]> {
    return this.db.enrollment.findMany({
      where: { studentProfileId: studentId, status: { not: 'PENDING_LINK' } },
      include: {
        class: { include: { program: true, weeklySchedules: true } },
        placements: {
          include: { class: { include: { program: true, weeklySchedules: true } } },
          orderBy: { effectiveFrom: 'asc' },
        },
        registrationOrder: { include: { payment: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getClass(user: AuthenticatedUser, id: string, page: PageDto): Promise<unknown> {
    this.requireRoles(user, 'STAFF', 'MANAGER', 'TEACHER');
    const classroom = await this.db.class.findUnique({
      where: { id },
      include: {
        program: true,
        teacher: { select: { id: true, displayName: true, email: true } },
        weeklySchedules: { orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] },
      },
    });
    this.assert(classroom, 'CLASS_NOT_FOUND', 'Class not found', HttpStatus.NOT_FOUND);
    this.assert(
      user.role !== 'TEACHER' || classroom.teacherId === user.id,
      'FORBIDDEN',
      'Class is not assigned to this teacher',
      HttpStatus.FORBIDDEN,
    );
    const where: Prisma.EnrollmentWhereInput = { classId: id, status: { not: 'PENDING_LINK' } };
    const [items, total] = await Promise.all([
      this.db.enrollment.findMany({
        where,
        select: {
          id: true,
          status: true,
          startDate: true,
          endDate: true,
          packageMonths: true,
          studentProfile: { select: { id: true, fullName: true, grade: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page.page - 1) * page.limit,
        take: page.limit,
      }),
      this.db.enrollment.count({ where }),
    ]);
    return { ...classroom, enrollments: { items, page: page.page, limit: page.limit, total } };
  }

  async updateProgram(
    user: AuthenticatedUser,
    id: string,
    input: UpdateProgramDto,
  ): Promise<unknown> {
    this.requireRoles(user, 'MANAGER');
    return this.transaction(async (tx) => {
      const program = await tx.program.findUnique({ where: { id } });
      this.assert(program, 'PROGRAM_NOT_FOUND', 'Program not found', HttpStatus.NOT_FOUND);
      const changesIdentity =
        (input.grade !== undefined && input.grade !== program.grade) ||
        (input.subject !== undefined && input.subject.trim() !== program.subject);
      if (changesIdentity) {
        const [classes, lessons] = await Promise.all([
          tx.class.count({ where: { programId: id } }),
          tx.lesson.count({ where: { programId: id } }),
        ]);
        this.assert(
          !classes && !lessons,
          'PROGRAM_IN_USE',
          'Cannot change grade or subject while the program has classes or lessons',
        );
      }
      return tx.program.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name.trim() }),
          ...(input.subject === undefined ? {} : { subject: input.subject.trim() }),
          ...(input.grade === undefined ? {} : { grade: input.grade }),
        },
      });
    });
  }

  async deleteProgram(user: AuthenticatedUser, id: string): Promise<unknown> {
    this.requireRoles(user, 'MANAGER');
    return this.transaction(async (tx) => {
      const program = await tx.program.findUnique({ where: { id } });
      this.assert(program, 'PROGRAM_NOT_FOUND', 'Program not found', HttpStatus.NOT_FOUND);
      const [classes, lessons] = await Promise.all([
        tx.class.count({ where: { programId: id } }),
        tx.lesson.count({ where: { programId: id } }),
      ]);
      this.assert(
        !classes && !lessons,
        'PROGRAM_IN_USE',
        'Cannot delete a program that has classes or lessons',
      );
      await tx.program.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'PROGRAM_DELETE',
          entityType: 'Program',
          entityId: id,
          beforeData: { name: program.name, subject: program.subject, grade: program.grade },
        },
      });
      return { id, deleted: true };
    });
  }

  private loadStudentForRegistration(
    client: Prisma.TransactionClient | DatabaseService,
    studentId: string,
  ): Promise<StudentForRegistration | null> {
    return client.studentProfile.findUnique({
      where: { id: studentId },
      include: { parentProfile: { include: { user: true } } },
    });
  }

  private studentTermEnrollments(
    client: Prisma.TransactionClient | DatabaseService,
    studentId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<StudentTermEnrollment[]> {
    return client.enrollment.findMany({
      where: {
        studentProfileId: studentId,
        status: 'ACTIVE',
        startDate: { lt: endDate },
        endDate: { gt: startDate },
      },
      select: {
        classId: true,
        startDate: true,
        endDate: true,
        class: { select: { weeklySchedules: true } },
      },
    });
  }

  private async assertRegistrationAllowed(
    tx: Prisma.TransactionClient,
    student: StudentForRegistration,
    classroom: ClassForRegistration,
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    const [classEnrollments, studentEnrollments] = await Promise.all([
      tx.enrollment.findMany({
        where: {
          classId: classroom.id,
          status: 'ACTIVE',
          startDate: { lt: endDate },
          endDate: { gt: startDate },
        },
        select: { classId: true, startDate: true, endDate: true },
      }),
      this.studentTermEnrollments(tx, student.id, startDate, endDate),
    ]);
    const problem = registrationProblem({
      student,
      classroom,
      startDate,
      endDate,
      classEnrollments,
      studentEnrollments,
    });
    if (problem) throw new AppError(problem.code, problem.message, HttpStatus.CONFLICT);
  }

  private async findVisibleStudent(
    user: AuthenticatedUser,
    studentId: string,
  ): Promise<{ id: string; grade: number }> {
    const student = await this.db.studentProfile.findUnique({
      where: { id: studentId },
      include: { parentProfile: true },
    });
    this.assert(student, 'STUDENT_NOT_FOUND', 'Student profile not found', HttpStatus.NOT_FOUND);
    this.assert(
      user.role !== 'PARENT' || student.parentProfile.userId === user.id,
      'FORBIDDEN',
      'Student profile does not belong to this parent',
      HttpStatus.FORBIDDEN,
    );
    return student;
  }

  private async parentProfileForUser(userId: string): Promise<{ id: string }> {
    const profile = await this.db.parentProfile.findUnique({ where: { userId } });
    this.assert(
      profile,
      'PARENT_PROFILE_NOT_FOUND',
      'Parent profile not found',
      HttpStatus.NOT_FOUND,
    );
    return profile;
  }

  private async assertTeacher(teacherId?: string | null): Promise<void> {
    if (!teacherId) return;
    const teacher = await this.db.user.findFirst({
      where: { id: teacherId, role: 'TEACHER', status: 'ACTIVE' },
    });
    this.assert(teacher, 'INVALID_TEACHER', 'An active teacher is required');
  }

  private assertCanReadRegistration(user: AuthenticatedUser, parentEmail: string): void {
    if (user.role === 'PARENT') {
      this.assert(
        user.email === parentEmail,
        'FORBIDDEN',
        'Registration does not belong to this parent',
        HttpStatus.FORBIDDEN,
      );
      return;
    }
    this.requireRoles(user, 'STAFF');
  }

  private assertVerifiedParent(user: AuthenticatedUser): void {
    this.assert(
      user.emailVerifiedAt,
      'PARENT_EMAIL_UNVERIFIED',
      'Verify email before managing student profiles',
    );
  }

  private requireRoles(user: AuthenticatedUser, ...roles: AuthenticatedUser['role'][]): void {
    this.assert(
      roles.includes(user.role),
      'FORBIDDEN',
      'Role is not allowed',
      HttpStatus.FORBIDDEN,
    );
  }

  private assert(
    condition: unknown,
    code: string,
    message: string,
    status = HttpStatus.CONFLICT,
  ): asserts condition {
    if (!condition)
      throw new AppError(code, message, code === 'FORBIDDEN' ? HttpStatus.FORBIDDEN : status);
  }

  private assertNoScheduleOverlaps(
    schedules: { weekday: number; startTime: string; endTime: string }[],
  ): void {
    for (let i = 0; i < schedules.length; i++) {
      for (let j = i + 1; j < schedules.length; j++) {
        const a = schedules[i],
          b = schedules[j];
        this.assert(
          a.weekday !== b.weekday ||
            timeToMinutes(a.startTime) >= timeToMinutes(b.endTime) ||
            timeToMinutes(a.endTime) <= timeToMinutes(b.startTime),
          'CLASS_SCHEDULE_CONFLICT',
          'Class schedules cannot overlap',
        );
      }
    }
  }

  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(work, {
          isolationLevel: 'Serializable',
          timeout: 20_000,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 2
        )
          continue;
        throw error;
      }
    }
  }
}

type EnrollmentWithPlacements = Prisma.EnrollmentGetPayload<{
  include: {
    class: { include: { program: true; weeklySchedules: true } };
    placements: { include: { class: { include: { program: true; weeklySchedules: true } } } };
    registrationOrder: { include: { payment: true } };
  };
}>;

/**
 * Weekly slots a student still attends: ACTIVE enrollments whose term has not expired, expanded by
 * placement so a scheduled transfer replaces the old class instead of leaving its stale timetable.
 */
function scheduleOf(enrollments: EnrollmentWithPlacements[]): Record<string, unknown>[] {
  const today = todayLocalDate();
  const now = new Date();
  return enrollments
    .filter((e) => e.status === 'ACTIVE' && e.startDate && e.endDate && e.endDate > today)
    .flatMap((enrollment) => {
      const segments = enrollment.placements.length
        ? enrollment.placements.filter((p) => !p.effectiveTo || p.effectiveTo > now)
        : [{ class: enrollment.class, effectiveFrom: null, effectiveTo: null }];
      return segments.flatMap((segment) =>
        segment.class.weeklySchedules.map((schedule) => ({
          enrollmentId: enrollment.id,
          classId: segment.class.id,
          className: segment.class.name,
          subject: segment.class.program.subject,
          grade: segment.class.program.grade,
          startDate: enrollment.startDate,
          endDate: enrollment.endDate,
          effectiveFrom: segment.effectiveFrom,
          effectiveTo: segment.effectiveTo,
          weekday: schedule.weekday,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
        })),
      );
    });
}

interface StudentForRegistration {
  id: string;
  fullName: string;
  grade: number;
  status: string;
  parentProfile: {
    phone: string | null;
    user: {
      email: string;
      displayName: string | null;
      status: string;
      emailVerifiedAt: Date | null;
    };
  };
}

interface ClassForRegistration {
  id: string;
  isOpen: boolean;
  capacity: number;
  program: { grade: number };
  weeklySchedules: ClassWeeklySchedule[];
}

interface TermEnrollment {
  classId: string;
  startDate: Date | null;
  endDate: Date | null;
}

interface StudentTermEnrollment extends TermEnrollment {
  class: { weeklySchedules: ClassWeeklySchedule[] };
}

/**
 * Highest number of enrollments that occupy the class on any single day of [startDate, endDate).
 * Occupancy only changes on an enrollment start date, so those dates are the only points to test.
 */
function peakOccupancy(enrollments: TermEnrollment[], startDate: Date, endDate: Date): number {
  const dated = enrollments.filter(
    (item): item is { classId: string; startDate: Date; endDate: Date } =>
      !!item.startDate && !!item.endDate,
  );
  const points = [
    startDate,
    ...dated.map((item) => item.startDate).filter((day) => day > startDate && day < endDate),
  ];
  return Math.max(
    0,
    ...points.map(
      (point) => dated.filter((item) => item.startDate <= point && item.endDate > point).length,
    ),
  );
}

/** First reason a student cannot take the class for [startDate, endDate), or null when eligible. */
function registrationProblem(input: {
  student: StudentForRegistration | null;
  classroom: ClassForRegistration;
  startDate: Date;
  endDate: Date;
  classEnrollments: TermEnrollment[];
  studentEnrollments: StudentTermEnrollment[];
}): { code: string; message: string } | null {
  const { student, classroom, startDate, endDate } = input;
  const fail = (code: string, message: string): { code: string; message: string } => ({
    code,
    message,
  });
  if (student) {
    if (student.status !== 'ACTIVE') return fail('STUDENT_INACTIVE', 'Student profile is inactive');
    if (student.parentProfile.user.status !== 'ACTIVE')
      return fail('PARENT_DISABLED', 'Parent account is disabled');
    if (!student.parentProfile.user.emailVerifiedAt)
      return fail('PARENT_EMAIL_UNVERIFIED', 'Parent email must be verified first');
  }
  if (!classroom.isOpen) return fail('CLASS_CLOSED', 'Class is not open for registration');
  if (student && classroom.program.grade !== student.grade)
    return fail('CLASS_GRADE_MISMATCH', 'Class grade does not match student grade');
  if (!classroom.weeklySchedules.length)
    return fail('CLASS_NEEDS_SCHEDULE', 'Class must have a fixed weekly schedule');
  if (!classroom.weeklySchedules.some((slot) => slot.weekday === isoWeekday(startDate)))
    return fail('INVALID_START_DATE', 'Start date must be one of the class study weekdays');
  if (peakOccupancy(input.classEnrollments, startDate, endDate) >= classroom.capacity)
    return fail('CLASS_FULL', 'Class has no remaining seats');
  if (student) {
    if (input.studentEnrollments.some((enrollment) => enrollment.classId === classroom.id))
      return fail(
        'DUPLICATE_CLASS_REGISTRATION',
        'Student already has this class in the selected term',
      );
    if (
      input.studentEnrollments.some((enrollment) =>
        schedulesConflict(enrollment.class.weeklySchedules, classroom.weeklySchedules),
      )
    )
      return fail('STUDENT_SCHEDULE_CONFLICT', 'Student already has another class at this time');
  }
  return null;
}

const registrationInclude = {
  targetStudent: { select: { id: true, fullName: true, grade: true } },
  class: { include: { program: true, weeklySchedules: true } },
  payment: true,
  enrollment: true,
} satisfies Prisma.RegistrationOrderInclude;

const billInclude = {
  targetStudent: {
    include: {
      parentProfile: {
        include: { user: { select: { displayName: true, email: true } } },
      },
    },
  },
  class: { include: { program: true, weeklySchedules: true } },
  payment: true,
} satisfies Prisma.RegistrationOrderInclude;

type BillOrder = Prisma.RegistrationOrderGetPayload<{ include: typeof billInclude }>;

type BillSnapshot = {
  parent: { displayName: string | null; email: string; phone: string | null };
  student: { id: string; fullName: string; grade: number };
  class: {
    id: string;
    name: string;
    subject: string;
    grade: number;
    schedules: { weekday: number; startTime: string; endTime: string }[];
  };
  monthlyFee: string;
};

function billClassMatches(snapshot: BillSnapshot['class'], classroom: BillOrder['class']): boolean {
  const slots = (schedules: BillSnapshot['class']['schedules']): string[] =>
    schedules.map((slot) => `${slot.weekday}:${slot.startTime}-${slot.endTime}`).sort();
  return (
    snapshot.id === classroom.id &&
    snapshot.name === classroom.name &&
    snapshot.subject === classroom.program.subject &&
    snapshot.grade === classroom.program.grade &&
    JSON.stringify(slots(snapshot.schedules)) === JSON.stringify(slots(classroom.weeklySchedules))
  );
}

function billResponse(order: BillOrder): Record<string, unknown> {
  const snapshot = order.billSnapshot as BillSnapshot | null;
  return {
    billNumber: order.id,
    registrationId: order.id,
    status: order.payment ? 'PAID' : order.status === 'CANCELLED' ? 'CANCELLED' : 'UNPAID',
    issuedAt: order.createdAt.toISOString(),
    parent: snapshot?.parent ?? {
      displayName: order.targetStudent?.parentProfile.user.displayName ?? null,
      email: order.parentEmail,
      phone: order.parentPhone,
    },
    student: snapshot?.student ?? {
      id: order.targetStudentId,
      fullName: order.studentFullName,
      grade: order.studentGrade,
    },
    class: snapshot?.class ?? {
      id: order.class.id,
      name: order.class.name,
      subject: order.class.program.subject,
      grade: order.class.program.grade,
      schedules: order.class.weeklySchedules.map((slot) => ({
        weekday: slot.weekday,
        startTime: slot.startTime,
        endTime: slot.endTime,
      })),
    },
    term: {
      packageMonths: order.packageMonths,
      startDate: dateOnly(order.startDate),
      endDate: dateOnly(order.endDate),
    },
    pricing: {
      monthlyFee: snapshot?.monthlyFee ?? order.quotedAmount.div(order.packageMonths).toFixed(2),
      packageMonths: order.packageMonths,
      total: order.quotedAmount.toFixed(2),
      currency: order.currency,
    },
    payment: order.payment
      ? {
          receiptNumber: order.payment.receiptNumber,
          paidAmount: order.payment.amount.toFixed(2),
          confirmedAt: order.payment.confirmedAt.toISOString(),
        }
      : null,
  };
}

function normalizeProgram(input: ProgramDto): ProgramDto {
  return { name: input.name.trim(), subject: input.subject.trim(), grade: input.grade };
}

function receiptResponse(order: {
  id: string;
  parentEmail: string;
  studentFullName: string;
  studentGrade: number;
  packageMonths: number;
  quotedAmount: Prisma.Decimal;
  currency: string;
  startDate: Date | null;
  endDate: Date | null;
  status: string;
  payment: {
    id: string;
    receiptNumber: string;
    confirmedAt: Date;
    amount: Prisma.Decimal;
    currency: string;
  } | null;
  enrollment: { id: string; status: string; startDate: Date | null; endDate: Date | null } | null;
  class: {
    id: string;
    name: string;
    program: { subject: string; grade: number };
    weeklySchedules: ClassWeeklySchedule[];
  };
}): Record<string, unknown> {
  return {
    registrationId: order.id,
    status: order.status,
    parentEmail: order.parentEmail,
    student: { fullName: order.studentFullName, grade: order.studentGrade },
    class: {
      id: order.class.id,
      name: order.class.name,
      subject: order.class.program.subject,
      grade: order.class.program.grade,
      schedules: order.class.weeklySchedules,
    },
    term: {
      packageMonths: order.packageMonths,
      startDate: dateOnly(order.startDate),
      endDate: dateOnly(order.endDate),
      ...termStatus(order),
    },
    payment: order.payment
      ? {
          id: order.payment.id,
          receiptNumber: order.payment.receiptNumber,
          amount: Number(order.payment.amount),
          currency: order.payment.currency,
          confirmedAt: order.payment.confirmedAt.toISOString(),
        }
      : null,
    enrollment: order.enrollment
      ? { id: order.enrollment.id, status: order.enrollment.status }
      : null,
    quotedAmount: Number(order.quotedAmount),
    currency: order.currency,
  };
}

const TERM_LABELS = {
  UPCOMING: 'Sắp học',
  ACTIVE: 'Đang học',
  EXPIRED: 'Đã hết hạn',
  ENDED: 'Đã kết thúc',
} as const;

/** Term state from the [startDate, endDate) window and the enrollment status, never start date alone. */
function termStatus(order: {
  startDate: Date | null;
  endDate: Date | null;
  enrollment: { status: string; startDate: Date | null; endDate: Date | null } | null;
}): { status: keyof typeof TERM_LABELS; label: string } {
  const today = todayLocalDate();
  // The enrollment is what the student actually attends, so its dates win once it exists.
  const startDate = order.enrollment?.startDate ?? order.startDate;
  const endDate = order.enrollment?.endDate ?? order.endDate;
  let status: keyof typeof TERM_LABELS = 'ACTIVE';
  if (order.enrollment?.status === 'ENDED') status = 'ENDED';
  else if (endDate && endDate <= today) status = 'EXPIRED';
  else if (startDate && startDate > today) status = 'UPCOMING';
  return { status, label: TERM_LABELS[status] };
}

function hashRequest(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

function localDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function todayLocalDate(): Date {
  return localDate(new Date(Date.now() + HCM_OFFSET_MS).toISOString().slice(0, 10));
}

function atStartOfLocalDay(value: Date): Date {
  return new Date(value.getTime() - HCM_OFFSET_MS);
}

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function addCalendarMonths(startDate: Date, months: number): Date {
  const year = startDate.getUTCFullYear();
  const month = startDate.getUTCMonth();
  const day = startDate.getUTCDate();
  const targetFirst = new Date(Date.UTC(year, month + months, 1));
  const targetLastDay = new Date(
    Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0),
  ).getUTCDate();
  targetFirst.setUTCDate(Math.min(day, targetLastDay));
  return targetFirst;
}

function isoWeekday(date: Date): number {
  const day = new Date(date.getTime() + HCM_OFFSET_MS).getUTCDay();
  return day === 0 ? 7 : day;
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function schedulesConflict(left: ClassWeeklySchedule[], right: ClassWeeklySchedule[]): boolean {
  return left.some((a) =>
    right.some(
      (b) =>
        a.weekday === b.weekday &&
        timeToMinutes(a.startTime) < timeToMinutes(b.endTime) &&
        timeToMinutes(a.endTime) > timeToMinutes(b.startTime),
    ),
  );
}

function receiptNo(orderId: string): string {
  return `RCPT-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${orderId.slice(-6)}`;
}
