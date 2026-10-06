import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type ClassWeeklySchedule, type Lesson } from '@prisma/client';
import { AppError } from '../../common/errors/app.error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { DatabaseService } from '../../database/orm/database.service';
import {
  CreateCurriculumUnitDto,
  CurriculumLessonDto,
  CurriculumUnitFilterDto,
  MonthlyTestDto,
  ScheduleRangeDto,
  SessionQueryDto,
  UpdateCurriculumUnitDto,
} from './curriculum-scheduling.dto';

const DAY_MS = 86_400_000;
const HCM_OFFSET_MS = 7 * 3_600_000;
const unitInclude = {
  track: true,
  lessons: { orderBy: [{ kind: 'asc' }, { sequence: 'asc' }] },
} satisfies Prisma.CurriculumUnitInclude;

type UnitWithLessons = Prisma.CurriculumUnitGetPayload<{ include: typeof unitInclude }>;
type ClassWithSchedule = Prisma.ClassGetPayload<{
  include: { program: true; weeklySchedules: true; teacher: true };
}>;
type PlannedSlot = {
  date: string;
  startsAt: Date;
  endsAt: Date;
  lessonId: string;
  lessonTitle: string;
  kind: 'LESSON' | 'MONTHLY_TEST';
  monthKey: string;
};

@Injectable()
export class CurriculumSchedulingService {
  constructor(private readonly db: DatabaseService) {}

  async createUnit(user: AuthenticatedUser, input: CreateCurriculumUnitDto): Promise<unknown> {
    this.requireRole(user, 'CURRICULUM_DESIGNER');
    this.assertRange(input.fromDate, input.toDate);
    const program = await this.db.program.findUnique({ where: { id: input.programId } });
    this.assert(program, 'PROGRAM_NOT_FOUND', 'Program not found', HttpStatus.NOT_FOUND);
    const key = subjectKey(program.subject);
    const track = await this.db.curriculumTrack.upsert({
      where: { grade_subjectKey: { grade: program.grade, subjectKey: key } },
      create: { grade: program.grade, subjectKey: key, subject: program.subject.trim() },
      update: {},
    });
    return this.db.curriculumUnit.create({
      data: {
        trackId: track.id,
        programId: program.id,
        designerId: user.id,
        title: input.title.trim(),
        fromDate: localDate(input.fromDate),
        toDate: localDate(input.toDate),
      },
      include: unitInclude,
    });
  }

  async listUnits(user: AuthenticatedUser, filter: CurriculumUnitFilterDto): Promise<unknown> {
    this.requireRole(user, 'CURRICULUM_DESIGNER', 'MANAGER', 'TEACHER');
    const teacherTracks =
      user.role === 'TEACHER'
        ? (
            await this.db.class.findMany({
              where: { teacherId: user.id },
              include: { program: true },
            })
          ).map((row) => ({
            grade: row.program.grade,
            subjectKey: subjectKey(row.program.subject),
          }))
        : [];
    if (user.role === 'TEACHER' && !teacherTracks.length) return [];
    const program = filter.programId
      ? await this.db.program.findUnique({ where: { id: filter.programId } })
      : null;
    if (filter.programId)
      this.assert(program, 'PROGRAM_NOT_FOUND', 'Program not found', HttpStatus.NOT_FOUND);
    return this.db.curriculumUnit.findMany({
      where: {
        ...(user.role === 'CURRICULUM_DESIGNER' ? { designerId: user.id } : {}),
        ...(user.role === 'TEACHER' ? { status: 'APPROVED' as const } : {}),
        ...(user.role === 'TEACHER' ? { OR: teacherTracks.map((track) => ({ track })) } : {}),
        track: {
          ...(program ? { grade: program.grade, subjectKey: subjectKey(program.subject) } : {}),
          ...(filter.grade ? { grade: filter.grade } : {}),
          ...(filter.subject ? { subjectKey: subjectKey(filter.subject) } : {}),
        },
      },
      include: { track: true, _count: { select: { lessons: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async unit(user: AuthenticatedUser, id: string): Promise<unknown> {
    const unit = await this.loadUnit(id);
    await this.canReadUnit(user, unit);
    return unit;
  }

  async updateUnit(
    user: AuthenticatedUser,
    id: string,
    input: UpdateCurriculumUnitDto,
  ): Promise<unknown> {
    return this.transaction(async (tx) => {
      const unit = await this.lockEditableUnit(tx, user, id);
      const from = input.fromDate ?? dateOnly(unit.fromDate);
      const to = input.toDate ?? dateOnly(unit.toDate);
      this.assertRange(from, to);
      const months = unit.lessons.filter((lesson) => lesson.kind === 'MONTHLY_TEST');
      this.assert(
        months.every(
          (lesson) =>
            lesson.monthKey &&
            lesson.monthKey >= from.slice(0, 7) &&
            lesson.monthKey <= to.slice(0, 7),
        ),
        'TEST_OUTSIDE_UNIT',
        'The new range would exclude an existing monthly test',
      );
      return tx.curriculumUnit.update({
        where: { id },
        data: {
          ...(input.title === undefined ? {} : { title: input.title.trim() }),
          fromDate: localDate(from),
          toDate: localDate(to),
        },
        include: unitInclude,
      });
    });
  }

  async addLesson(
    user: AuthenticatedUser,
    id: string,
    input: CurriculumLessonDto,
  ): Promise<unknown> {
    return this.transaction(async (tx) => {
      const unit = await this.lockEditableUnit(tx, user, id);
      return tx.lesson.create({
        data: {
          unitId: id,
          programId: unit.programId,
          designerId: user.id,
          kind: 'LESSON',
          sequence: input.sequence,
          title: input.title.trim(),
          content: input.content.trim(),
        },
      });
    });
  }

  async updateLesson(
    user: AuthenticatedUser,
    unitId: string,
    lessonId: string,
    input: CurriculumLessonDto,
  ): Promise<unknown> {
    return this.transaction(async (tx) => {
      const unit = await this.lockEditableUnit(tx, user, unitId);
      const lesson = unit.lessons.find((item) => item.id === lessonId && item.kind === 'LESSON');
      this.assert(
        lesson,
        'LESSON_NOT_FOUND',
        'Lesson not found in this unit',
        HttpStatus.NOT_FOUND,
      );
      return tx.lesson.update({
        where: { id: lessonId },
        data: {
          title: input.title.trim(),
          content: input.content.trim(),
          sequence: input.sequence,
        },
      });
    });
  }

  async setMonthlyTest(
    user: AuthenticatedUser,
    id: string,
    input: MonthlyTestDto,
  ): Promise<unknown> {
    return this.transaction(async (tx) => {
      const unit = await this.lockEditableUnit(tx, user, id);
      this.assert(
        input.monthKey >= dateOnly(unit.fromDate).slice(0, 7) &&
          input.monthKey <= dateOnly(unit.toDate).slice(0, 7),
        'TEST_OUTSIDE_UNIT',
        'Test month is outside the curriculum unit',
      );
      const monthIndex = monthOrdinal(input.monthKey);
      return tx.lesson.upsert({
        where: {
          unitId_kind_monthKey: { unitId: id, kind: 'MONTHLY_TEST', monthKey: input.monthKey },
        },
        create: {
          unitId: id,
          programId: unit.programId,
          designerId: user.id,
          kind: 'MONTHLY_TEST',
          monthKey: input.monthKey,
          sequence: monthIndex,
          title: input.title.trim(),
          content: input.content.trim(),
        },
        update: { title: input.title.trim(), content: input.content.trim() },
      });
    });
  }

  async approveUnit(user: AuthenticatedUser, id: string): Promise<unknown> {
    this.requireRole(user, 'MANAGER');
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM curriculum_units WHERE id = ${id} FOR UPDATE`;
        const unit = await tx.curriculumUnit.findUnique({ where: { id }, include: unitInclude });
        this.assert(unit, 'UNIT_NOT_FOUND', 'Curriculum unit not found', HttpStatus.NOT_FOUND);
        this.assert(unit.status === 'DRAFT', 'UNIT_LOCKED', 'Only a draft unit can be approved');
        const classes = await tx.class.findMany({
          where: { program: { grade: unit.track.grade } },
          include: { program: true, weeklySchedules: true },
        });
        const matching = classes.filter(
          (row) =>
            subjectKey(row.program.subject) === unit.track.subjectKey && row.weeklySchedules.length,
        );
        this.assert(
          matching.length,
          'NO_SCHEDULED_CLASS',
          'Configure at least one class weekly schedule before approval',
        );
        let maxRegular = 0;
        const requiredMonths = new Set<string>();
        for (const classroom of matching) {
          const slots = slotsForRange(
            classroom.weeklySchedules,
            dateOnly(unit.fromDate),
            dateOnly(unit.toDate),
          );
          const tests = lastMonthlySlots(slots);
          maxRegular = Math.max(maxRegular, slots.length - tests.size);
          for (const month of tests.keys()) requiredMonths.add(month);
        }
        const regular = unit.lessons
          .filter((lesson) => lesson.kind === 'LESSON')
          .sort((a, b) => a.sequence - b.sequence);
        this.assert(
          regular.length >= maxRegular,
          'INSUFFICIENT_LESSONS',
          'Curriculum does not cover all scheduled lessons',
        );
        this.assert(
          regular.every((lesson, i) => lesson.sequence === i + 1),
          'LESSON_SEQUENCE_GAP',
          'Lesson sequence must start at 1 without gaps',
        );
        this.assert(
          [...requiredMonths].every((month) =>
            unit.lessons.some(
              (lesson) => lesson.kind === 'MONTHLY_TEST' && lesson.monthKey === month,
            ),
          ),
          'MISSING_MONTHLY_TEST',
          'Add one monthly test for each month with scheduled sessions',
        );
        await tx.lesson.updateMany({ where: { unitId: id }, data: { status: 'APPROVED' } });
        const approved = await tx.curriculumUnit.update({
          where: { id },
          data: { status: 'APPROVED', approvedAt: new Date() },
          include: unitInclude,
        });
        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            action: 'CURRICULUM_UNIT_APPROVED',
            entityType: 'CurriculumUnit',
            entityId: id,
          },
        });
        return approved;
      },
      { isolationLevel: 'Serializable', timeout: 20_000 },
    );
  }

  async reviseUnit(user: AuthenticatedUser, id: string): Promise<unknown> {
    this.requireRole(user, 'CURRICULUM_DESIGNER');
    return this.db.$transaction(
      async (tx) => {
        const unit = await tx.curriculumUnit.findUnique({ where: { id }, include: unitInclude });
        this.assert(unit, 'UNIT_NOT_FOUND', 'Curriculum unit not found', HttpStatus.NOT_FOUND);
        this.assert(
          unit.designerId === user.id,
          'FORBIDDEN',
          'Unit belongs to another designer',
          HttpStatus.FORBIDDEN,
        );
        this.assert(
          unit.status === 'APPROVED',
          'UNIT_NOT_APPROVED',
          'Only an approved unit can be revised',
        );
        const latest = await tx.curriculumUnit.aggregate({
          where: { trackId: unit.trackId, fromDate: unit.fromDate, toDate: unit.toDate },
          _max: { version: true },
        });
        const copy = await tx.curriculumUnit.create({
          data: {
            trackId: unit.trackId,
            programId: unit.programId,
            designerId: user.id,
            basedOnId: id,
            version: (latest._max.version ?? 0) + 1,
            title: unit.title,
            fromDate: unit.fromDate,
            toDate: unit.toDate,
          },
        });
        await tx.lesson.createMany({
          data: unit.lessons.map((lesson) => ({
            unitId: copy.id,
            programId: unit.programId,
            designerId: user.id,
            title: lesson.title,
            content: lesson.content,
            sequence: lesson.sequence,
            kind: lesson.kind,
            monthKey: lesson.monthKey,
          })),
        });
        return tx.curriculumUnit.findUniqueOrThrow({
          where: { id: copy.id },
          include: unitInclude,
        });
      },
      { isolationLevel: 'Serializable', timeout: 20_000 },
    );
  }

  async preview(
    user: AuthenticatedUser,
    classId: string,
    input: ScheduleRangeDto,
  ): Promise<unknown> {
    this.requireRole(user, 'MANAGER');
    const [unit, classroom] = await Promise.all([
      this.loadUnit(input.curriculumUnitId),
      this.loadClass(classId),
    ]);
    const slots = this.plan(unit, classroom, input);
    const conflicts = await this.findConflicts(this.db, classroom, slots);
    const existingMatching = slots.length
      ? await this.db.classSession.findMany({
          where: {
            lessonId: { in: [...new Set(slots.map((slot) => slot.lessonId))] },
            classId: { not: classId },
            status: 'SCHEDULED',
            startsAt: { gt: new Date() },
          },
          select: { id: true, classId: true, lessonId: true, startsAt: true, endsAt: true },
        })
      : [];
    return {
      classId,
      curriculumUnitId: unit.id,
      fromDate: input.fromDate,
      toDate: input.toDate,
      slots: slots.map((slot) => ({
        ...slot,
        conflicts: conflicts.filter((conflict) => overlaps(slot, conflict)),
        makeupCandidates: existingMatching.filter(
          (session) => session.lessonId === slot.lessonId && session.startsAt > slot.startsAt,
        ),
      })),
    };
  }

  async generate(
    user: AuthenticatedUser,
    classId: string,
    input: ScheduleRangeDto,
    key: string | undefined,
  ): Promise<unknown> {
    this.requireRole(user, 'MANAGER');
    const idempotencyKey = key?.trim();
    this.assert(
      idempotencyKey && idempotencyKey.length <= 191,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key is required (max 191 characters)',
      HttpStatus.BAD_REQUEST,
    );
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          classId,
          curriculumUnitId: input.curriculumUnitId,
          fromDate: input.fromDate,
          toDate: input.toDate,
        }),
      )
      .digest('hex');
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM classes WHERE id = ${classId} FOR UPDATE`;
      const prior = await tx.scheduleGeneration.findUnique({
        where: { classId_key: { classId, key: idempotencyKey } },
      });
      if (prior) {
        this.assert(
          prior.requestHash === requestHash,
          'IDEMPOTENCY_CONFLICT',
          'Key was used with a different request',
        );
        return this.generationResult(tx, prior.id);
      }
      const [unit, classroom] = await Promise.all([
        tx.curriculumUnit.findUnique({
          where: { id: input.curriculumUnitId },
          include: unitInclude,
        }),
        tx.class.findUnique({
          where: { id: classId },
          include: { program: true, weeklySchedules: true, teacher: true },
        }),
      ]);
      this.assert(unit, 'UNIT_NOT_FOUND', 'Curriculum unit not found', HttpStatus.NOT_FOUND);
      this.assert(classroom, 'CLASS_NOT_FOUND', 'Class not found', HttpStatus.NOT_FOUND);
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${classroom.teacherId} FOR UPDATE`;
      const slots = this.plan(unit, classroom, input);
      const conflicts = await this.findConflicts(tx, classroom, slots);
      this.assert(
        !conflicts.length,
        'SCHEDULE_CONFLICT',
        'Class or teacher already has a session at this time',
      );
      const generation = await tx.scheduleGeneration.create({
        data: {
          classId,
          unitId: unit.id,
          actorUserId: user.id,
          key: idempotencyKey,
          requestHash,
          fromDate: localDate(input.fromDate),
          toDate: localDate(input.toDate),
        },
      });
      await tx.classSession.createMany({
        data: slots.map((slot) => ({
          classId,
          lessonId: slot.lessonId,
          teacherId: classroom.teacherId!,
          generationId: generation.id,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
        })),
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'CLASS_SESSIONS_GENERATED',
          entityType: 'ScheduleGeneration',
          entityId: generation.id,
          afterData: { classId, unitId: unit.id, count: slots.length },
        },
      });
      return this.generationResult(tx, generation.id);
    });
  }

  async sessions(user: AuthenticatedUser, query: SessionQueryDto): Promise<unknown> {
    this.requireRole(user, 'MANAGER', 'STAFF', 'TEACHER', 'PARENT');
    const today = dateOnly(new Date(Date.now() + HCM_OFFSET_MS));
    const fromDate = user.role === 'PARENT' ? (query.fromDate ?? today) : query.fromDate;
    const toDate =
      user.role === 'PARENT'
        ? (query.toDate ?? dateOnly(new Date(localDate(fromDate!).getTime() + 30 * DAY_MS)))
        : query.toDate;
    if (fromDate && toDate) this.assertRange(fromDate, toDate);
    const enrollments =
      user.role === 'PARENT'
        ? await this.db.enrollment.findMany({
            where: { status: 'ACTIVE', studentProfile: { parentProfile: { userId: user.id } } },
            select: {
              classId: true,
              startDate: true,
              endDate: true,
              placements: { select: { classId: true, effectiveFrom: true, effectiveTo: true } },
            },
          })
        : [];
    if (user.role === 'PARENT' && !enrollments.length) return [];
    const parentClassIds = [
      ...new Set(
        enrollments.flatMap((item) => [
          item.classId,
          ...item.placements.map((placement) => placement.classId),
        ]),
      ),
    ];
    const start = fromDate ? localDate(fromDate) : undefined;
    const endExclusive = toDate ? new Date(localDate(toDate).getTime() + DAY_MS) : undefined;
    const rows = await this.db.classSession.findMany({
      where: {
        ...(user.role === 'PARENT'
          ? {
              classId: {
                in: query.classId
                  ? parentClassIds.filter((id) => id === query.classId)
                  : parentClassIds,
              },
            }
          : query.classId
            ? { classId: query.classId }
            : {}),
        ...(start || endExclusive
          ? {
              startsAt: {
                ...(start ? { gte: new Date(start.getTime() - HCM_OFFSET_MS) } : {}),
                ...(endExclusive ? { lt: new Date(endExclusive.getTime() - HCM_OFFSET_MS) } : {}),
              },
            }
          : {}),
        ...(user.role === 'TEACHER' ? { teacherId: user.id } : {}),
        ...(user.role === 'PARENT' ? { status: { not: 'CANCELLED' as const } } : {}),
      },
      select: {
        id: true,
        classId: true,
        teacherId: true,
        startsAt: true,
        endsAt: true,
        status: true,
        class: { select: { name: true, program: { select: { grade: true, subject: true } } } },
        lesson: { select: { id: true, title: true, kind: true, monthKey: true, unitId: true } },
      },
      orderBy: { startsAt: 'asc' },
      ...(user.role === 'PARENT'
        ? {}
        : { skip: (query.page - 1) * query.limit, take: query.limit }),
    });
    if (user.role !== 'PARENT') return rows;
    return rows
      .filter((session) =>
        enrollments.some((enrollment) => {
          const day = localDate(
            new Date(session.startsAt.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 10),
          );
          if (
            !enrollment.startDate ||
            !enrollment.endDate ||
            day < enrollment.startDate ||
            day >= enrollment.endDate
          )
            return false;
          if (!enrollment.placements.length) return enrollment.classId === session.classId;
          return enrollment.placements.some(
            (placement) =>
              placement.classId === session.classId &&
              placement.effectiveFrom <= session.startsAt &&
              (!placement.effectiveTo || placement.effectiveTo > session.startsAt),
          );
        }),
      )
      .slice((query.page - 1) * query.limit, query.page * query.limit);
  }

  private plan(
    unit: UnitWithLessons,
    classroom: ClassWithSchedule,
    input: ScheduleRangeDto,
  ): PlannedSlot[] {
    this.assertRange(input.fromDate, input.toDate);
    this.assert(
      unit.status === 'APPROVED',
      'UNIT_NOT_APPROVED',
      'Curriculum unit must be approved',
    );
    this.assert(
      input.fromDate >= dateOnly(unit.fromDate) && input.toDate <= dateOnly(unit.toDate),
      'RANGE_OUTSIDE_UNIT',
      'Requested dates are outside the unit',
    );
    this.assert(
      classroom.program.grade === unit.track.grade &&
        subjectKey(classroom.program.subject) === unit.track.subjectKey,
      'CURRICULUM_MISMATCH',
      'Class and curriculum subject/grade do not match',
    );
    this.assert(
      classroom.teacher?.role === 'TEACHER' && classroom.teacher.status === 'ACTIVE',
      'INVALID_TEACHER',
      'Assign an active teacher to the class',
    );
    this.assert(
      classroom.weeklySchedules.length,
      'CLASS_NEEDS_SCHEDULE',
      'Class needs a weekly schedule',
    );
    const dated = slotsForRange(
      classroom.weeklySchedules,
      dateOnly(unit.fromDate),
      dateOnly(unit.toDate),
    );
    this.assert(
      dated.some((item) => item.date >= input.fromDate && item.date <= input.toDate),
      'NO_SESSIONS',
      'No class sessions fall in the requested range',
    );
    const monthlyLast = lastMonthlySlots(dated);
    const lessons = unit.lessons
      .filter((row) => row.kind === 'LESSON')
      .sort((a, b) => a.sequence - b.sequence);
    const tests = new Map(
      unit.lessons.filter((row) => row.kind === 'MONTHLY_TEST').map((row) => [row.monthKey, row]),
    );
    let lessonIndex = 0;
    return dated
      .map((item, index) => {
        const month = item.date.slice(0, 7);
        const isTest = monthlyLast.get(month) === index;
        const lesson: Lesson | undefined = isTest ? tests.get(month) : lessons[lessonIndex++];
        this.assert(
          lesson,
          isTest ? 'MISSING_MONTHLY_TEST' : 'INSUFFICIENT_LESSONS',
          isTest ? `Missing test for ${month}` : 'Not enough approved lessons for this range',
        );
        this.assert(
          lesson.status === 'APPROVED',
          'LESSON_NOT_APPROVED',
          'All scheduled content must be approved',
        );
        return {
          date: item.date,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          kind: lesson.kind,
          monthKey: month,
        };
      })
      .filter((item) => item.date >= input.fromDate && item.date <= input.toDate);
  }

  private async findConflicts(
    tx: Prisma.TransactionClient,
    classroom: ClassWithSchedule,
    slots: PlannedSlot[],
  ): Promise<
    Array<{ id: string; classId: string; teacherId: string; startsAt: Date; endsAt: Date }>
  > {
    if (!slots.length) return [];
    const first = slots[0].startsAt;
    const last = slots[slots.length - 1].endsAt;
    const rows = await tx.classSession.findMany({
      where: {
        status: { not: 'CANCELLED' },
        startsAt: { lt: last },
        endsAt: { gt: first },
        OR: [{ classId: classroom.id }, { teacherId: classroom.teacherId! }],
      },
      select: { id: true, classId: true, teacherId: true, startsAt: true, endsAt: true },
    });
    return rows.filter((row) => slots.some((slot) => overlaps(slot, row)));
  }

  private async generationResult(tx: Prisma.TransactionClient, id: string): Promise<unknown> {
    return tx.scheduleGeneration.findUniqueOrThrow({
      where: { id },
      include: {
        sessions: {
          include: { lesson: { select: { id: true, title: true, kind: true, monthKey: true } } },
          orderBy: { startsAt: 'asc' },
        },
      },
    });
  }

  private async loadUnit(id: string): Promise<UnitWithLessons> {
    const unit = await this.db.curriculumUnit.findUnique({ where: { id }, include: unitInclude });
    this.assert(unit, 'UNIT_NOT_FOUND', 'Curriculum unit not found', HttpStatus.NOT_FOUND);
    return unit;
  }

  private async loadClass(id: string): Promise<ClassWithSchedule> {
    const classroom = await this.db.class.findUnique({
      where: { id },
      include: { program: true, weeklySchedules: true, teacher: true },
    });
    this.assert(classroom, 'CLASS_NOT_FOUND', 'Class not found', HttpStatus.NOT_FOUND);
    return classroom;
  }

  private async lockEditableUnit(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    id: string,
  ): Promise<UnitWithLessons> {
    this.requireRole(user, 'CURRICULUM_DESIGNER');
    await tx.$queryRaw`SELECT id FROM curriculum_units WHERE id = ${id} FOR UPDATE`;
    const unit = await tx.curriculumUnit.findUnique({ where: { id }, include: unitInclude });
    this.assert(unit, 'UNIT_NOT_FOUND', 'Curriculum unit not found', HttpStatus.NOT_FOUND);
    this.assertEditable(user, unit);
    return unit;
  }

  private async canReadUnit(user: AuthenticatedUser, unit: UnitWithLessons): Promise<void> {
    this.requireRole(user, 'MANAGER', 'CURRICULUM_DESIGNER', 'TEACHER');
    if (user.role === 'CURRICULUM_DESIGNER')
      this.assert(
        unit.designerId === user.id,
        'FORBIDDEN',
        'Unit belongs to another designer',
        HttpStatus.FORBIDDEN,
      );
    if (user.role === 'TEACHER') {
      this.assert(
        unit.status === 'APPROVED',
        'FORBIDDEN',
        'Unit is not approved',
        HttpStatus.FORBIDDEN,
      );
      const assigned = await this.db.class.findMany({
        where: { teacherId: user.id, program: { grade: unit.track.grade } },
        include: { program: true },
      });
      this.assert(
        assigned.some((row) => subjectKey(row.program.subject) === unit.track.subjectKey),
        'FORBIDDEN',
        'No assigned class for this unit',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private assertEditable(user: AuthenticatedUser, unit: UnitWithLessons): void {
    this.requireRole(user, 'CURRICULUM_DESIGNER');
    this.assert(
      unit.designerId === user.id,
      'FORBIDDEN',
      'Unit belongs to another designer',
      HttpStatus.FORBIDDEN,
    );
    this.assert(unit.status === 'DRAFT', 'UNIT_LOCKED', 'Approved unit cannot be edited');
  }

  private assertRange(from: string, to: string): void {
    this.assert(
      from <= to,
      'INVALID_DATE_RANGE',
      'fromDate must be on or before toDate',
      HttpStatus.BAD_REQUEST,
    );
    const days = Math.round((localDate(to).getTime() - localDate(from).getTime()) / DAY_MS) + 1;
    this.assert(
      days <= 366,
      'DATE_RANGE_TOO_LONG',
      'Range must be at most 366 days',
      HttpStatus.BAD_REQUEST,
    );
  }

  private requireRole(user: AuthenticatedUser, ...roles: AuthenticatedUser['role'][]): void {
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
    if (!condition) throw new AppError(code, message, status);
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

function localDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function subjectKey(subject: string): string {
  return subject
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .toLocaleLowerCase('vi')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .normalize('NFKC');
}

function monthOrdinal(month: string): number {
  const [year, number] = month.split('-').map(Number);
  return year * 12 + number;
}

export function slotsForRange(
  schedules: Array<Pick<ClassWeeklySchedule, 'weekday' | 'startTime' | 'endTime'>>,
  from: string,
  to: string,
): Array<{ date: string; startsAt: Date; endsAt: Date }> {
  const result: Array<{ date: string; startsAt: Date; endsAt: Date }> = [];
  for (let day = localDate(from); day <= localDate(to); day = new Date(day.getTime() + DAY_MS)) {
    const weekday = day.getUTCDay() || 7;
    for (const schedule of schedules.filter((item) => item.weekday === weekday)) {
      const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
      const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
      result.push({
        date: dateOnly(day),
        startsAt: new Date(day.getTime() + (startHour * 60 + startMinute) * 60_000 - HCM_OFFSET_MS),
        endsAt: new Date(day.getTime() + (endHour * 60 + endMinute) * 60_000 - HCM_OFFSET_MS),
      });
    }
  }
  return result.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export function lastMonthlySlots(slots: Array<{ date: string }>): Map<string, number> {
  const result = new Map<string, number>();
  slots.forEach((slot, index) => result.set(slot.date.slice(0, 7), index));
  return result;
}

function overlaps(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
): boolean {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}
