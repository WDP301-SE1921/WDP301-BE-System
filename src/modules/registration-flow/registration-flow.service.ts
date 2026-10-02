import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type ClassWeeklySchedule } from '@prisma/client';

import { AppError } from '../../common/errors/app.error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { DatabaseService } from '../../database/orm/database.service';
import {
  ClassDto,
  ClassFilterDto,
  CreateRegistrationDto,
  CreateStudentDto,
  PageDto,
  ProgramDto,
  ReplaceClassSchedulesDto,
  UpdateClassDto,
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
      const classroom = await tx.class.findUnique({
        where: { id },
        include: { weeklySchedules: true },
      });
      this.assert(classroom, 'CLASS_NOT_FOUND', 'Class not found', HttpStatus.NOT_FOUND);
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
    return rows;
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
      const active = await tx.enrollment.count({
        where: { classId, status: { not: 'ENDED' } },
      });
      this.assert(
        !active,
        'CLASS_SCHEDULE_LOCKED',
        'Cannot change schedule while class has enrollments',
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
  ): Promise<unknown> {
    this.requireRoles(user, 'STAFF', 'MANAGER');
    const startDate = localDate(input.startDate);
    const endDate = addCalendarMonths(startDate, input.packageMonths);
    this.assert(
      startDate >= todayLocalDate(),
      'INVALID_START_DATE',
      'Start date must be today or a future date',
    );
    return this.transaction(async (tx) => {
      const [student, classroom] = await Promise.all([
        tx.studentProfile.findUnique({
          where: { id: input.targetStudentId },
          include: { parentProfile: { include: { user: true } } },
        }),
        tx.class.findUnique({
          where: { id: input.classId },
          include: { program: true, weeklySchedules: true },
        }),
      ]);
      this.assert(student, 'STUDENT_NOT_FOUND', 'Student profile not found', HttpStatus.NOT_FOUND);
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
          startDate,
          endDate,
          status: 'DRAFT',
          createdByManagerId: user.id,
        },
        include: registrationInclude,
      });
    });
  }

  async registration(user: AuthenticatedUser, id: string): Promise<unknown> {
    const order = await this.db.registrationOrder.findUnique({
      where: { id },
      include: registrationInclude,
    });
    this.assert(order, 'REGISTRATION_NOT_FOUND', 'Registration not found', HttpStatus.NOT_FOUND);
    this.assertCanReadRegistration(user, order.parentEmail);
    return order;
  }

  async cancelRegistration(user: AuthenticatedUser, id: string): Promise<unknown> {
    this.requireRoles(user, 'STAFF', 'MANAGER');
    return this.db.registrationOrder.update({
      where: { id, status: 'DRAFT' },
      data: { status: 'CANCELLED' },
      include: registrationInclude,
    });
  }

  async confirmPayment(
    user: AuthenticatedUser,
    id: string,
    idempotencyKey: string | undefined,
    receiptNumber?: string,
  ): Promise<unknown> {
    this.requireRoles(user, 'STAFF', 'MANAGER');
    this.assert(idempotencyKey, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    const scope = `confirm-payment:${id}`;
    const existing = await this.db.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key: idempotencyKey } },
    });
    if (existing) return existing.response;
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
      if (order.status === 'COMPLETED' && order.payment && order.enrollment) {
        const response = receiptResponse(order);
        await tx.idempotencyRecord.create({
          data: {
            scope,
            key: idempotencyKey,
            registrationOrderId: id,
            response: response as Prisma.InputJsonObject,
          },
        });
        return response;
      }
      this.assert(
        order.status === 'DRAFT',
        'REGISTRATION_NOT_DRAFT',
        'Only draft registrations can be confirmed',
      );
      this.assert(
        order.targetStudent && order.startDate && order.endDate,
        'INVALID_REGISTRATION',
        'Registration is missing student or term data',
      );
      await tx.$queryRaw`SELECT id FROM student_profiles WHERE id = ${order.targetStudentId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM classes WHERE id = ${order.classId} FOR UPDATE`;
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
          response: response as Prisma.InputJsonObject,
        },
      });
      return response;
    });
  }

  async receipt(user: AuthenticatedUser, id: string): Promise<unknown> {
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
    return this.db.enrollment.findMany({
      where: { studentProfileId: studentId, status: { not: 'PENDING_LINK' } },
      include: {
        class: { include: { program: true, weeklySchedules: true } },
        registrationOrder: { include: { payment: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async myStudentSchedule(user: AuthenticatedUser, studentId: string): Promise<unknown> {
    const enrollments = (await this.myStudentEnrollments(user, studentId)) as Array<{
      id: string;
      startDate: Date | null;
      endDate: Date | null;
      class: {
        id: string;
        name: string;
        weeklySchedules: ClassWeeklySchedule[];
        program: { subject: string; grade: number };
      };
    }>;
    return enrollments.flatMap((enrollment) =>
      enrollment.class.weeklySchedules.map((schedule) => ({
        enrollmentId: enrollment.id,
        classId: enrollment.class.id,
        className: enrollment.class.name,
        subject: enrollment.class.program.subject,
        grade: enrollment.class.program.grade,
        startDate: enrollment.startDate,
        endDate: enrollment.endDate,
        weekday: schedule.weekday,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      })),
    );
  }

  private async assertRegistrationAllowed(
    tx: Prisma.TransactionClient,
    student: {
      id: string;
      fullName: string;
      grade: number;
      status: string;
      parentProfile: { user: { email: string; status: string; emailVerifiedAt: Date | null } };
    },
    classroom: {
      id: string;
      isOpen: boolean;
      capacity: number;
      program: { grade: number };
      weeklySchedules: ClassWeeklySchedule[];
    },
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    this.assert(student.status === 'ACTIVE', 'STUDENT_INACTIVE', 'Student profile is inactive');
    this.assert(
      student.parentProfile.user.status === 'ACTIVE',
      'PARENT_DISABLED',
      'Parent account is disabled',
    );
    this.assert(
      student.parentProfile.user.emailVerifiedAt,
      'PARENT_EMAIL_UNVERIFIED',
      'Parent email must be verified first',
    );
    this.assert(classroom.isOpen, 'CLASS_CLOSED', 'Class is not open for registration');
    this.assert(
      classroom.program.grade === student.grade,
      'CLASS_GRADE_MISMATCH',
      'Class grade does not match student grade',
    );
    this.assert(
      classroom.weeklySchedules.length > 0,
      'CLASS_NEEDS_SCHEDULE',
      'Class must have a fixed weekly schedule',
    );
    this.assert(
      classroom.weeklySchedules.some((slot) => slot.weekday === isoWeekday(startDate)),
      'INVALID_START_DATE',
      'Start date must be one of the class study weekdays',
    );
    const seatCount = await tx.enrollment.count({
      where: {
        classId: classroom.id,
        status: 'ACTIVE',
        startDate: { lt: endDate },
        endDate: { gt: startDate },
      },
    });
    this.assert(seatCount < classroom.capacity, 'CLASS_FULL', 'Class has no remaining seats');
    const overlaps = await tx.enrollment.findMany({
      where: {
        studentProfileId: student.id,
        status: 'ACTIVE',
        startDate: { lt: endDate },
        endDate: { gt: startDate },
      },
      include: { class: { include: { weeklySchedules: true } } },
    });
    this.assert(
      !overlaps.some((enrollment) => enrollment.classId === classroom.id),
      'DUPLICATE_CLASS_REGISTRATION',
      'Student already has this class in the selected term',
    );
    this.assert(
      !overlaps.some((enrollment) =>
        schedulesConflict(enrollment.class.weeklySchedules, classroom.weeklySchedules),
      ),
      'STUDENT_SCHEDULE_CONFLICT',
      'Student already has another class at this time',
    );
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
    this.requireRoles(user, 'STAFF', 'MANAGER');
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

const registrationInclude = {
  targetStudent: { select: { id: true, fullName: true, grade: true } },
  class: { include: { program: true, weeklySchedules: true } },
  payment: true,
  enrollment: true,
} satisfies Prisma.RegistrationOrderInclude;

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
      label: order.startDate && order.startDate > todayLocalDate() ? 'Sắp học' : 'Đang học',
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
