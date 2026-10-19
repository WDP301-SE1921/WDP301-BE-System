import { NotificationEventsService } from '../notifications/notification-events.service';
import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type ClassWeeklySchedule, type Lesson } from '@prisma/client';
import { AppError } from '../../common/errors/app.error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { DatabaseService } from '../../database/orm/database.service';
import { assignedTeacherAt, assignedTeacherWhere } from '../registration-flow/class-teacher';
import {
  CreateCurriculumUnitDto,
  CurriculumLessonDto,
  CurriculumUnitFilterDto,
  MonthlyTestDto,
  ScheduleRangeDto,
  SessionQueryDto,
  SessionRescheduleDto,
  ImportCommitDto,
  ImportRowDto,
  UpdateCurriculumUnitDto,
} from './curriculum-scheduling.dto';
import type { ParentCurriculumResponseDto } from '../academic/parent-learning-response.dto';
import type { PageDto } from '../academic/academic.dto';
import { pageResult } from '../../common/pagination';
import { parentEnrollmentSelect, parentSessionWhere } from './parent-session-access';
import { parseCurriculumCsv } from './curriculum-csv';

const DAY_MS = 86_400_000;
const HCM_OFFSET_MS = 7 * 3_600_000;
const unitInclude = {
  track: true,
  lessons: { orderBy: [{ kind: 'asc' }, { sequence: 'asc' }] },
} satisfies Prisma.CurriculumUnitInclude;

type UnitWithLessons = Prisma.CurriculumUnitGetPayload<{ include: typeof unitInclude }>;
type ClassWithSchedule = Prisma.ClassGetPayload<{
  include: { program: { include: { subjectRecord: true } }; weeklySchedules: true; teacher: true };
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

function slotsTeacherIds(classroom: ClassWithSchedule, slots: PlannedSlot[]): string[] {
  return [...new Set(slots.map((slot) => assignedTeacherAt(classroom, slot.startsAt)))].filter(
    (id): id is string => !!id,
  );
}

@Injectable()
export class CurriculumSchedulingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationEventsService,
  ) {}

  async createUnit(user: AuthenticatedUser, input: CreateCurriculumUnitDto): Promise<unknown> {
    this.requireRole(user, 'CURRICULUM_DESIGNER');
    this.assertRange(input.fromDate, input.toDate);
    const program = await this.db.program.findUnique({ where: { id: input.programId } });
    this.assert(program, 'PROGRAM_NOT_FOUND', 'Program not found', HttpStatus.NOT_FOUND);
    this.assert(program.isActive, 'PROGRAM_INACTIVE', 'Program is inactive');
    if (program.subjectId) {
      const subject = await this.db.subject.findUnique({ where: { id: program.subjectId } });
      this.assert(subject?.isActive, 'SUBJECT_INACTIVE', 'Subject is inactive');
    }
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

  async studentCurriculum(
    user: AuthenticatedUser,
    studentId: string,
    page: PageDto,
  ): Promise<ParentCurriculumResponseDto> {
    this.requireRole(user, 'PARENT');
    await this.assertParentStudent(user, studentId);
    const now = new Date();
    const today = localDate(dateOnly(new Date(now.getTime() + HCM_OFFSET_MS)));
    const enrollments = await this.db.enrollment.findMany({
      where: {
        studentProfileId: studentId,
        status: 'ACTIVE',
        startDate: { lte: today },
        endDate: { gt: today },
      },
      select: {
        startDate: true,
        endDate: true,
        class: { select: { id: true, name: true, programId: true } },
        placements: {
          where: {
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          },
          select: { class: { select: { id: true, name: true, programId: true } } },
        },
        _count: { select: { placements: true } },
      },
    });
    const scopes = enrollments.flatMap((enrollment) => {
      const classroom =
        enrollment.placements[0]?.class ??
        (enrollment._count.placements === 0 ? enrollment.class : null);
      return classroom && enrollment.startDate && enrollment.endDate
        ? [{ classroom, startDate: enrollment.startDate, endDate: enrollment.endDate }]
        : [];
    });
    if (!scopes.length)
      return { studentId, items: [], page: page.page, limit: page.limit, total: 0 };
    const where: Prisma.CurriculumUnitWhereInput = {
      status: 'APPROVED',
      OR: scopes.map((scope) => ({
        programId: scope.classroom.programId,
        fromDate: { lt: scope.endDate },
        toDate: { gte: scope.startDate },
      })),
    };
    const [units, total] = await Promise.all([
      this.db.curriculumUnit.findMany({
        where,
        skip: (page.page - 1) * page.limit,
        take: page.limit,
        select: {
          id: true,
          title: true,
          programId: true,
          fromDate: true,
          toDate: true,
          version: true,
          program: { select: { subject: true, grade: true } },
          lessons: {
            where: { status: 'APPROVED' },
            select: { id: true, title: true, sequence: true, kind: true, monthKey: true },
            orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
          },
        },
        orderBy: [{ fromDate: 'asc' }, { version: 'desc' }, { id: 'asc' }],
      }),
      this.db.curriculumUnit.count({ where }),
    ]);
    return {
      studentId,
      page: page.page,
      limit: page.limit,
      total,
      items: units.map((unit) => ({
        ...unit,
        classes: scopes
          .filter(
            (scope) =>
              scope.classroom.programId === unit.programId &&
              unit.fromDate < scope.endDate &&
              unit.toDate >= scope.startDate,
          )
          .map((scope) => ({ id: scope.classroom.id, name: scope.classroom.name })),
      })),
    };
  }

  async listUnits(user: AuthenticatedUser, filter: CurriculumUnitFilterDto): Promise<unknown> {
    this.requireRole(user, 'CURRICULUM_DESIGNER', 'MANAGER', 'TEACHER');
    const teacherPrograms =
      user.role === 'TEACHER'
        ? (
            await this.db.class.findMany({
              where: assignedTeacherWhere(user.id, new Date()),
              include: { program: true },
            })
          ).map((row) => row.programId)
        : [];
    if (user.role === 'TEACHER' && !teacherPrograms.length) return [];
    const program = filter.programId
      ? await this.db.program.findUnique({ where: { id: filter.programId } })
      : null;
    if (filter.programId)
      this.assert(program, 'PROGRAM_NOT_FOUND', 'Program not found', HttpStatus.NOT_FOUND);
    if (user.role === 'TEACHER' && program && !teacherPrograms.includes(program.id)) return [];
    const where: Prisma.CurriculumUnitWhereInput = {
      ...(user.role === 'CURRICULUM_DESIGNER' ? { designerId: user.id } : {}),
      ...(user.role === 'TEACHER' ? { status: 'APPROVED' as const } : {}),
      ...(filter.status && user.role !== 'TEACHER' ? { status: filter.status } : {}),
      ...(user.role === 'TEACHER' ? { programId: { in: teacherPrograms } } : {}),
      ...(program ? { programId: program.id } : {}),
      track: {
        ...(filter.grade ? { grade: filter.grade } : {}),
        ...(filter.subject ? { subjectKey: subjectKey(filter.subject) } : {}),
      },
      ...(filter.search ? { title: { contains: filter.search.trim() } } : {}),
    };
    const include = {
      track: true,
      program: { select: { id: true, name: true, subject: true, grade: true } },
      _count: { select: { lessons: true } },
    } as const;
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    if (filter.paginated) {
      const [items, total] = await Promise.all([
        this.db.curriculumUnit.findMany({
          where,
          include,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.db.curriculumUnit.count({ where }),
      ]);
      return { items, page, limit, total };
    }
    return this.db.curriculumUnit.findMany({
      where,
      include,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
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
      this.checkRevision(unit, input.expectedRevision);
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
          revision: { increment: 1 },
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
      this.checkRevision(unit, input.expectedRevision);
      const created = await tx.lesson.create({
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
      await tx.curriculumUnit.update({ where: { id }, data: { revision: { increment: 1 } } });
      return created;
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
      this.checkRevision(unit, input.expectedRevision);
      const lesson = unit.lessons.find((item) => item.id === lessonId && item.kind === 'LESSON');
      this.assert(
        lesson,
        'LESSON_NOT_FOUND',
        'Lesson not found in this unit',
        HttpStatus.NOT_FOUND,
      );
      const updated = await tx.lesson.update({
        where: { id: lessonId },
        data: {
          title: input.title.trim(),
          content: input.content.trim(),
          sequence: input.sequence,
        },
      });
      await tx.curriculumUnit.update({
        where: { id: unitId },
        data: { revision: { increment: 1 } },
      });
      return updated;
    });
  }

  async setMonthlyTest(
    user: AuthenticatedUser,
    id: string,
    input: MonthlyTestDto,
  ): Promise<unknown> {
    return this.transaction(async (tx) => {
      const unit = await this.lockEditableUnit(tx, user, id);
      this.checkRevision(unit, input.expectedRevision);
      this.assert(
        input.monthKey >= dateOnly(unit.fromDate).slice(0, 7) &&
          input.monthKey <= dateOnly(unit.toDate).slice(0, 7),
        'TEST_OUTSIDE_UNIT',
        'Test month is outside the curriculum unit',
      );
      const monthIndex = monthOrdinal(input.monthKey);
      const result = await tx.lesson.upsert({
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
      await tx.curriculumUnit.update({ where: { id }, data: { revision: { increment: 1 } } });
      return result;
    });
  }

  async deleteLesson(user: AuthenticatedUser, unitId: string, lessonId: string): Promise<unknown> {
    return this.transaction(async (tx) => {
      const unit = await this.lockEditableUnit(tx, user, unitId);
      const lesson = unit.lessons.find((row) => row.id === lessonId);
      this.assert(
        lesson,
        'LESSON_NOT_FOUND',
        'Lesson not found in this unit',
        HttpStatus.NOT_FOUND,
      );
      const [sessions, feedback] = await Promise.all([
        tx.classSession.count({ where: { lessonId } }),
        tx.curriculumFeedback.count({
          where: { OR: [{ lessonId }, { resolutionLessonId: lessonId }] },
        }),
      ]);
      this.assert(!sessions && !feedback, 'LESSON_IN_USE', 'Lesson has dependent history');
      await tx.lesson.delete({ where: { id: lessonId } });
      if (lesson.kind === 'LESSON') {
        const ordered = unit.lessons
          .filter((row) => row.kind === 'LESSON' && row.id !== lessonId)
          .sort((a, b) => a.sequence - b.sequence)
          .map((row) => row.id);
        await this.writeLessonOrder(tx, ordered);
      }
      await tx.curriculumUnit.update({
        where: { id: unitId },
        data: { revision: { increment: 1 } },
      });
      return { id: lessonId, deleted: true };
    });
  }

  async reorderLessons(
    user: AuthenticatedUser,
    unitId: string,
    orderedIds: string[],
    expectedRevision?: number,
  ): Promise<unknown> {
    return this.transaction(async (tx) => {
      const unit = await this.lockEditableUnit(tx, user, unitId);
      this.checkRevision(unit, expectedRevision);
      const existing = unit.lessons.filter((row) => row.kind === 'LESSON').map((row) => row.id);
      this.assert(
        orderedIds.length === existing.length &&
          new Set(orderedIds).size === existing.length &&
          orderedIds.every((id) => existing.includes(id)),
        'INVALID_LESSON_ORDER',
        'Order must contain each lesson once',
      );
      await this.writeLessonOrder(tx, orderedIds);
      await tx.curriculumUnit.update({
        where: { id: unitId },
        data: { revision: { increment: 1 } },
      });
      return tx.curriculumUnit.findUniqueOrThrow({ where: { id: unitId }, include: unitInclude });
    });
  }

  private async writeLessonOrder(tx: Prisma.TransactionClient, ids: string[]): Promise<void> {
    for (let index = 0; index < ids.length; index++)
      await tx.lesson.update({ where: { id: ids[index] }, data: { sequence: -(index + 1) } });
    for (let index = 0; index < ids.length; index++)
      await tx.lesson.update({ where: { id: ids[index] }, data: { sequence: index + 1 } });
  }

  async importPreview(
    user: AuthenticatedUser,
    id: string,
    file: Express.Multer.File | undefined,
    mode: string,
  ): Promise<unknown> {
    const unit = await this.loadUnit(id);
    this.assertEditable(user, unit);
    this.assert(
      mode === 'APPEND' || mode === 'REPLACE',
      'INVALID_IMPORT_MODE',
      'Use APPEND or REPLACE',
      HttpStatus.BAD_REQUEST,
    );
    this.assert(
      file?.buffer && file.buffer.length > 0,
      'CSV_REQUIRED',
      'Upload a CSV file',
      HttpStatus.BAD_REQUEST,
    );
    let rows;
    try {
      rows = parseCurriculumCsv(file.buffer);
    } catch (error) {
      throw new AppError(
        'CSV_INVALID',
        error instanceof Error ? error.message : 'Invalid CSV',
        HttpStatus.BAD_REQUEST,
      );
    }
    const errors = this.importErrors(unit, rows, mode);
    const preview = await this.db.curriculumImportPreview.create({
      data: {
        unitId: id,
        actorUserId: user.id,
        expectedRevision: unit.revision,
        mode,
        rows,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    return {
      previewId: preview.id,
      unitId: id,
      expectedRevision: unit.revision,
      expiresAt: preview.expiresAt,
      summary: {
        rows: rows.length,
        validRows: rows.length - new Set(errors.map((item) => item.rowNumber)).size,
        invalidRows: new Set(errors.map((item) => item.rowNumber)).size,
      },
      rows: rows.map((row) => ({
        ...row,
        errors: errors.filter((error) => error.rowNumber === row.rowNumber),
      })),
    };
  }

  async importCommit(
    user: AuthenticatedUser,
    id: string,
    input: ImportCommitDto,
    key: string | undefined,
  ): Promise<unknown> {
    this.requireRole(user, 'CURRICULUM_DESIGNER');
    const idempotencyKey = key?.trim();
    this.assert(
      idempotencyKey && idempotencyKey.length <= 191,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key is required',
      HttpStatus.BAD_REQUEST,
    );
    const hash = createHash('sha256')
      .update(JSON.stringify({ actorId: user.id, id, input }))
      .digest('hex');
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM curriculum_units WHERE id = ${id} FOR UPDATE`;
      const prior = await tx.curriculumImportCommit.findUnique({
        where: { unitId_key: { unitId: id, key: idempotencyKey } },
      });
      if (prior) {
        this.assert(
          prior.actorUserId === user.id && prior.requestHash === hash,
          'IDEMPOTENCY_CONFLICT',
          'Key was used for another import',
        );
        return prior.response;
      }
      const unit = await tx.curriculumUnit.findUnique({ where: { id }, include: unitInclude });
      this.assert(unit, 'UNIT_NOT_FOUND', 'Curriculum unit not found', HttpStatus.NOT_FOUND);
      this.assertEditable(user, unit);
      this.assert(
        unit.revision === input.expectedRevision,
        'REVISION_CONFLICT',
        'Draft changed; preview it again',
      );
      const preview = await tx.curriculumImportPreview.findUnique({
        where: { id: input.previewId },
      });
      this.assert(
        preview &&
          preview.unitId === id &&
          preview.actorUserId === user.id &&
          preview.mode === input.mode &&
          preview.expectedRevision === input.expectedRevision &&
          preview.expiresAt > new Date(),
        'IMPORT_PREVIEW_STALE',
        'Import preview is expired or does not match the draft',
      );
      this.assert(
        input.rows.length > 0 && input.rows.length <= 1000,
        'INVALID_IMPORT',
        'Import must have 1 to 1000 rows',
      );
      const previewRows = preview.rows as unknown as Array<{
        rowNumber: number;
        kind: string;
        sequence: number | null;
        title: string;
        content: string;
        monthKey: string | null;
      }>;
      const rowValues = (row: {
        rowNumber: number;
        kind: string;
        sequence?: number | null;
        title: string;
        content: string;
        monthKey?: string | null;
      }): unknown[] => [
        row.rowNumber,
        row.kind,
        row.sequence ?? null,
        row.title,
        row.content,
        row.monthKey ?? null,
      ];
      this.assert(
        JSON.stringify(previewRows.map(rowValues)) === JSON.stringify(input.rows.map(rowValues)),
        'IMPORT_PREVIEW_STALE',
        'Import rows differ from the preview; preview again',
      );
      const errors = this.importErrors(unit, input.rows, input.mode);
      this.assert(
        !errors.length,
        'INVALID_IMPORT',
        `Import has ${errors.length} validation errors`,
        HttpStatus.BAD_REQUEST,
      );
      if (input.mode === 'REPLACE') {
        const [sessions, feedback, revisions] = await Promise.all([
          tx.classSession.count({ where: { lesson: { unitId: id } } }),
          tx.curriculumFeedback.count({
            where: { OR: [{ lesson: { unitId: id } }, { resolutionLesson: { unitId: id } }] },
          }),
          tx.lesson.count({ where: { basedOn: { unitId: id } } }),
        ]);
        this.assert(
          !sessions && !feedback && !revisions,
          'UNIT_IN_USE',
          'Draft lessons have dependent sessions, feedback or revisions',
        );
        await tx.lesson.deleteMany({ where: { unitId: id } });
      }
      await tx.lesson.createMany({
        data: input.rows.map((row) => ({
          unitId: id,
          programId: unit.programId,
          designerId: user.id,
          kind: row.kind,
          sequence: row.kind === 'MONTHLY_TEST' ? monthOrdinal(row.monthKey!) : row.sequence!,
          monthKey: row.kind === 'MONTHLY_TEST' ? row.monthKey : null,
          title: row.title.trim(),
          content: row.content.trim(),
        })),
      });
      const updated = await tx.curriculumUnit.update({
        where: { id },
        data: { revision: { increment: 1 } },
      });
      const response = {
        unitId: id,
        revision: updated.revision,
        createdCount: input.rows.length,
        lessonCount: await tx.lesson.count({ where: { unitId: id, kind: 'LESSON' } }),
        testCount: await tx.lesson.count({ where: { unitId: id, kind: 'MONTHLY_TEST' } }),
      };
      await tx.curriculumImportCommit.create({
        data: {
          unitId: id,
          actorUserId: user.id,
          key: idempotencyKey,
          requestHash: hash,
          response,
        },
      });
      return response;
    });
  }

  private importErrors(
    unit: UnitWithLessons,
    rows: Array<ImportRowDto | ReturnType<typeof parseCurriculumCsv>[number]>,
    mode: string,
  ): Array<{ rowNumber: number; field: string; code: string }> {
    const errors: Array<{ rowNumber: number; field: string; code: string }> = [];
    const lessonStart =
      mode === 'APPEND' ? unit.lessons.filter((row) => row.kind === 'LESSON').length + 1 : 1;
    const months = new Set(
      mode === 'APPEND'
        ? unit.lessons.filter((row) => row.kind === 'MONTHLY_TEST').map((row) => row.monthKey)
        : [],
    );
    let expected = lessonStart;
    for (const row of rows) {
      if (row.kind !== 'LESSON' && row.kind !== 'MONTHLY_TEST')
        errors.push({ rowNumber: row.rowNumber, field: 'kind', code: 'INVALID_KIND' });
      if (!row.title?.trim() || row.title.length > 255)
        errors.push({ rowNumber: row.rowNumber, field: 'title', code: 'INVALID_TITLE' });
      if (!row.content?.trim() || row.content.length > 50000)
        errors.push({ rowNumber: row.rowNumber, field: 'content', code: 'INVALID_CONTENT' });
      if (row.kind === 'LESSON') {
        if (row.sequence !== expected)
          errors.push({ rowNumber: row.rowNumber, field: 'sequence', code: 'INVALID_SEQUENCE' });
        expected++;
      } else if (row.kind === 'MONTHLY_TEST') {
        if (
          !row.monthKey ||
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.monthKey) ||
          row.monthKey < dateOnly(unit.fromDate).slice(0, 7) ||
          row.monthKey > dateOnly(unit.toDate).slice(0, 7) ||
          months.has(row.monthKey)
        )
          errors.push({ rowNumber: row.rowNumber, field: 'monthKey', code: 'INVALID_MONTH' });
        if (row.monthKey) months.add(row.monthKey);
      }
    }
    return errors;
  }

  async submitUnit(user: AuthenticatedUser, id: string): Promise<unknown> {
    return this.transaction(async (tx) => {
      const unit = await this.lockEditableUnit(tx, user, id);
      this.validateDraft(unit);
      const result = await tx.curriculumUnit.update({
        where: { id },
        data: { status: 'PENDING_REVIEW', submittedAt: new Date(), reviewNote: null },
        include: unitInclude,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'CURRICULUM_UNIT_SUBMITTED',
          entityType: 'CurriculumUnit',
          entityId: id,
        },
      });
      await this.notifications.curriculum(
        tx,
        user.id,
        id,
        'CURRICULUM_SUBMITTED',
        'Giáo trình đang chờ duyệt.',
        `CURRICULUM_SUBMITTED:${id}:${unit.revision}`,
      );
      return result;
    });
  }

  async validation(user: AuthenticatedUser, id: string): Promise<unknown> {
    const unit = await this.loadUnit(id);
    await this.canReadUnit(user, unit);
    const errors = this.draftErrors(unit);
    return {
      unitId: id,
      revision: unit.revision,
      ready: errors.length === 0,
      errors,
      lessonCount: unit.lessons.filter((row) => row.kind === 'LESSON').length,
      monthlyTestCount: unit.lessons.filter((row) => row.kind === 'MONTHLY_TEST').length,
    };
  }

  async requestChanges(user: AuthenticatedUser, id: string, reason: string): Promise<unknown> {
    this.requireRole(user, 'MANAGER');
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM curriculum_units WHERE id = ${id} FOR UPDATE`;
      const unit = await tx.curriculumUnit.findUnique({ where: { id } });
      this.assert(unit, 'UNIT_NOT_FOUND', 'Curriculum unit not found', HttpStatus.NOT_FOUND);
      this.assert(
        unit.status === 'PENDING_REVIEW',
        'UNIT_NOT_PENDING',
        'Unit is not pending review',
      );
      const result = await tx.curriculumUnit.update({
        where: { id },
        data: {
          status: 'DRAFT',
          reviewedAt: new Date(),
          reviewedById: user.id,
          reviewNote: reason.trim(),
          revision: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'CURRICULUM_UNIT_CHANGES_REQUESTED',
          entityType: 'CurriculumUnit',
          entityId: id,
          afterData: { reason: reason.trim() },
        },
      });
      await this.notifications.curriculum(
        tx,
        user.id,
        id,
        'CURRICULUM_CHANGES_REQUESTED',
        'Giáo trình cần được chỉnh sửa.',
        `CURRICULUM_CHANGES_REQUESTED:${id}:${unit.revision}`,
      );
      return result;
    });
  }

  async deleteUnit(user: AuthenticatedUser, id: string): Promise<unknown> {
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM curriculum_units WHERE id = ${id} FOR UPDATE`;
      const unit = await tx.curriculumUnit.findUnique({ where: { id } });
      this.assert(unit, 'UNIT_NOT_FOUND', 'Curriculum unit not found', HttpStatus.NOT_FOUND);
      if (unit.status === 'APPROVED' || unit.status === 'ARCHIVED') {
        this.requireRole(user, 'MANAGER');
        if (unit.status === 'ARCHIVED') return unit;
        return tx.curriculumUnit.update({ where: { id }, data: { status: 'ARCHIVED' } });
      }
      this.assertEditable(user, unit as UnitWithLessons);
      const [generations, revisions] = await Promise.all([
        tx.scheduleGeneration.count({ where: { unitId: id } }),
        tx.curriculumUnit.count({ where: { basedOnId: id } }),
      ]);
      this.assert(!generations && !revisions, 'UNIT_IN_USE', 'Unit has dependent history');
      const feedback = await tx.curriculumFeedback.count({ where: { lesson: { unitId: id } } });
      this.assert(!feedback, 'UNIT_IN_USE', 'Unit has teacher feedback');
      await tx.curriculumImportPreview.deleteMany({ where: { unitId: id } });
      await tx.curriculumImportCommit.deleteMany({ where: { unitId: id } });
      await tx.lesson.deleteMany({ where: { unitId: id } });
      await tx.curriculumUnit.delete({ where: { id } });
      return { id, deleted: true };
    });
  }

  private validateDraft(unit: UnitWithLessons): void {
    const first = this.draftErrors(unit)[0];
    if (first) this.assert(false, first.code, first.message);
  }

  private checkRevision(unit: UnitWithLessons, expectedRevision?: number): void {
    if (expectedRevision !== undefined)
      this.assert(
        unit.revision === expectedRevision,
        'REVISION_CONFLICT',
        'Draft changed; reload it',
      );
  }

  private draftErrors(unit: UnitWithLessons): Array<{ code: string; message: string }> {
    const errors: Array<{ code: string; message: string }> = [];
    const regular = unit.lessons
      .filter((lesson) => lesson.kind === 'LESSON')
      .sort((a, b) => a.sequence - b.sequence);
    if (!regular.length)
      errors.push({ code: 'EMPTY_CURRICULUM', message: 'Add at least one lesson' });
    if (!regular.every((lesson, index) => lesson.sequence === index + 1))
      errors.push({
        code: 'LESSON_SEQUENCE_GAP',
        message: 'Lessons must be numbered consecutively',
      });
    if (
      !unit.lessons
        .filter((lesson) => lesson.kind === 'MONTHLY_TEST')
        .every(
          (lesson) =>
            !!lesson.monthKey &&
            lesson.monthKey >= dateOnly(unit.fromDate).slice(0, 7) &&
            lesson.monthKey <= dateOnly(unit.toDate).slice(0, 7),
        )
    )
      errors.push({ code: 'TEST_OUTSIDE_UNIT', message: 'Monthly test is outside the unit range' });
    return errors;
  }

  async approveUnit(user: AuthenticatedUser, id: string): Promise<unknown> {
    this.requireRole(user, 'MANAGER');
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM curriculum_units WHERE id = ${id} FOR UPDATE`;
        const unit = await tx.curriculumUnit.findUnique({ where: { id }, include: unitInclude });
        this.assert(unit, 'UNIT_NOT_FOUND', 'Curriculum unit not found', HttpStatus.NOT_FOUND);
        this.assert(
          unit.status === 'PENDING_REVIEW',
          'UNIT_NOT_PENDING',
          'Submit the unit before approval',
        );
        const regular = unit.lessons
          .filter((lesson) => lesson.kind === 'LESSON')
          .sort((a, b) => a.sequence - b.sequence);
        this.assert(
          regular.length > 0,
          'EMPTY_CURRICULUM',
          'Add at least one lesson before approval',
        );
        this.assert(
          regular.every((lesson, i) => lesson.sequence === i + 1),
          'LESSON_SEQUENCE_GAP',
          'Lesson sequence must start at 1 without gaps',
        );
        this.assert(
          unit.lessons
            .filter((lesson) => lesson.kind === 'MONTHLY_TEST')
            .every(
              (lesson) =>
                !!lesson.monthKey &&
                lesson.monthKey >= dateOnly(unit.fromDate).slice(0, 7) &&
                lesson.monthKey <= dateOnly(unit.toDate).slice(0, 7),
            ),
          'TEST_OUTSIDE_UNIT',
          'Monthly test is outside the unit range',
        );
        await tx.lesson.updateMany({ where: { unitId: id }, data: { status: 'APPROVED' } });
        const approved = await tx.curriculumUnit.update({
          where: { id },
          data: {
            status: 'APPROVED',
            approvedAt: new Date(),
            reviewedAt: new Date(),
            reviewedById: user.id,
          },
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
        await this.notifications.curriculum(
          tx,
          user.id,
          id,
          'CURRICULUM_APPROVED',
          'Giáo trình đã được duyệt.',
          `CURRICULUM_APPROVED:${id}:${unit.revision}`,
        );
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
          where: { programId: unit.programId, fromDate: unit.fromDate, toDate: unit.toDate },
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
    const savedPreview = await this.db.schedulePreview.create({
      data: {
        classId,
        unitId: unit.id,
        actorUserId: user.id,
        fromDate: localDate(input.fromDate),
        toDate: localDate(input.toDate),
        snapshotHash: this.scheduleSnapshot(unit, classroom),
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });
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
      previewId: savedPreview.id,
      expiresAt: savedPreview.expiresAt,
      classId,
      curriculumUnitId: unit.id,
      fromDate: input.fromDate,
      toDate: input.toDate,
      summary: {
        total: slots.length,
        lessons: slots.filter((slot) => slot.kind === 'LESSON').length,
        monthlyTests: slots.filter((slot) => slot.kind === 'MONTHLY_TEST').length,
        conflicts: conflicts.length,
      },
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
          prior.requestHash === requestHash && prior.actorUserId === user.id,
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
          include: {
            program: { include: { subjectRecord: true } },
            weeklySchedules: true,
            teacher: true,
          },
        }),
      ]);
      this.assert(unit, 'UNIT_NOT_FOUND', 'Curriculum unit not found', HttpStatus.NOT_FOUND);
      this.assert(classroom, 'CLASS_NOT_FOUND', 'Class not found', HttpStatus.NOT_FOUND);
      if (input.previewId) {
        const preview = await tx.schedulePreview.findUnique({ where: { id: input.previewId } });
        this.assert(
          preview &&
            preview.actorUserId === user.id &&
            preview.classId === classId &&
            preview.unitId === unit.id &&
            dateOnly(preview.fromDate) === input.fromDate &&
            dateOnly(preview.toDate) === input.toDate &&
            preview.expiresAt > new Date() &&
            preview.snapshotHash === this.scheduleSnapshot(unit, classroom),
          'PREVIEW_STALE',
          'Schedule preview is stale; preview again',
        );
      }
      const teacherIds = [
        ...new Set(slotsTeacherIds(classroom, this.plan(unit, classroom, input))),
      ];
      for (const teacherId of teacherIds) {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${teacherId} FOR UPDATE`;
      }
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
          teacherId: assignedTeacherAt(classroom, slot.startsAt)!,
          roomId: classroom.roomId,
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
      const generatedSessions = await tx.classSession.findMany({
        where: { generationId: generation.id },
      });
      await this.notifications.send(
        tx,
        user.id,
        'SESSIONS_GENERATED',
        'CLASS',
        classId,
        'Đã có lịch học mới',
        `Lớp ${classroom.name}: đã xếp ${slots.length} buổi từ ${input.fromDate} đến ${input.toDate}.`,
        await this.notifications.recipients.sessions(tx, generatedSessions),
        classId,
        `generation:${generation.id}`,
      );
      return this.generationResult(tx, generation.id);
    });
  }

  async sessions(user: AuthenticatedUser, query: SessionQueryDto): Promise<unknown> {
    this.requireRole(user, 'MANAGER', 'STAFF', 'TEACHER', 'PARENT');
    const parent = user.role === 'PARENT';
    const today = dateOnly(new Date(Date.now() + HCM_OFFSET_MS));
    const fromDate = parent ? (query.fromDate ?? today) : query.fromDate;
    const toDate = parent
      ? (query.toDate ?? dateOnly(new Date(localDate(fromDate!).getTime() + 30 * DAY_MS)))
      : query.toDate;
    if (fromDate && toDate) this.assertRange(fromDate, toDate);
    if (parent && query.studentId) await this.assertParentStudent(user, query.studentId);
    const enrollments = parent
      ? await this.db.enrollment.findMany({
          where: {
            status: { not: 'PENDING_LINK' },
            studentProfile: {
              parentProfile: { userId: user.id },
              ...(query.studentId ? { id: query.studentId } : {}),
            },
          },
          select: parentEnrollmentSelect,
        })
      : [];
    const where: Prisma.ClassSessionWhereInput = {
      AND: [
        ...(parent ? [parentSessionWhere(enrollments)] : []),
        ...(query.classId ? [{ classId: query.classId }] : []),
        ...(user.role === 'TEACHER' ? [{ teacherId: user.id }] : []),
        {
          startsAt: {
            ...(fromDate ? { gte: new Date(localDate(fromDate).getTime() - HCM_OFFSET_MS) } : {}),
            ...(toDate
              ? { lt: new Date(localDate(toDate).getTime() + DAY_MS - HCM_OFFSET_MS) }
              : {}),
          },
        },
      ],
    };
    const items = this.db.classSession
      .findMany({
        where,
        select: {
          id: true,
          classId: true,
          teacherId: true,
          roomId: true,
          startsAt: true,
          endsAt: true,
          status: true,
          cancelReason: true,
          class: { select: { name: true, program: { select: { grade: true, subject: true } } } },
          teacher: { select: { id: true, displayName: true } },
          room: { select: { id: true, name: true } },
          lesson: { select: { id: true, title: true, kind: true, monthKey: true, unitId: true } },
          participants: {
            where: { enrollmentId: { in: enrollments.map((item) => item.id) }, cancelled: false },
            select: {
              id: true,
              enrollmentId: true,
              kind: true,
              attendance: true,
              cancelled: true,
              enrollment: { select: { studentProfileId: true } },
              sourceBookings: {
                select: { id: true, status: true, replacement: { select: { sessionId: true } } },
              },
              replacementBookings: {
                select: { id: true, status: true, original: { select: { sessionId: true } } },
                orderBy: { createdAt: 'desc' as const },
              },
            },
          },
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      })
      .then((rows) =>
        rows.map(({ participants, ...row }) =>
          parent
            ? {
                ...row,
                participations: participants.map((item) => ({
                  participantId: item.id,
                  enrollmentId: item.enrollmentId,
                  studentId: item.enrollment.studentProfileId,
                  kind: item.kind,
                  attendance: item.attendance,
                  cancelled: item.cancelled,
                  sourceMakeups: item.sourceBookings.map((booking) => ({
                    bookingId: booking.id,
                    status: booking.status,
                    targetSessionId: booking.replacement.sessionId,
                  })),
                  replacementMakeups: item.replacementBookings.map((booking) => ({
                    bookingId: booking.id,
                    status: booking.status,
                    sourceSessionId: booking.original.sessionId,
                  })),
                })),
              }
            : row,
        ),
      );
    return pageResult(query, items, () => this.db.classSession.count({ where }));
  }

  private async assertParentStudent(user: AuthenticatedUser, studentId: string): Promise<void> {
    const owned = await this.db.studentProfile.count({
      where: { id: studentId, parentProfile: { userId: user.id } },
    });
    this.assert(
      owned === 1,
      'FORBIDDEN',
      'Student does not belong to this parent',
      HttpStatus.FORBIDDEN,
    );
  }

  async sessionDetail(user: AuthenticatedUser, id: string, studentId?: string): Promise<unknown> {
    this.requireRole(user, 'MANAGER', 'STAFF', 'TEACHER', 'PARENT');
    if (user.role === 'PARENT') {
      this.assert(studentId, 'STUDENT_ID_REQUIRED', 'Select a student', HttpStatus.BAD_REQUEST);
      await this.assertParentStudent(user, studentId);
      const enrollments = await this.db.enrollment.findMany({
        where: {
          status: { not: 'PENDING_LINK' },
          studentProfile: { id: studentId, parentProfile: { userId: user.id } },
        },
        select: parentEnrollmentSelect,
      });
      const row = await this.db.classSession.findFirst({
        where: { AND: [{ id }, parentSessionWhere(enrollments)] },
        select: {
          id: true,
          classId: true,
          roomId: true,
          startsAt: true,
          endsAt: true,
          status: true,
          summary: true,
          cancelReason: true,
          class: {
            select: {
              name: true,
              roomId: true,
              program: { select: { subject: true, grade: true } },
            },
          },
          teacher: { select: { id: true, displayName: true } },
          room: { select: { id: true, name: true } },
          lesson: {
            select: {
              id: true,
              title: true,
              kind: true,
              sequence: true,
              monthKey: true,
              unitId: true,
            },
          },
          participants: {
            where: { enrollmentId: { in: enrollments.map((item) => item.id) }, cancelled: false },
            select: { id: true, enrollmentId: true, kind: true, attendance: true, cancelled: true },
            orderBy: { id: 'asc' },
            take: 1,
          },
        },
      });
      if (!row) {
        const exists = await this.db.classSession.count({ where: { id } });
        this.assert(
          !exists,
          'FORBIDDEN',
          'Session does not belong to this parent',
          HttpStatus.FORBIDDEN,
        );
        throw new AppError('SESSION_NOT_FOUND', 'Session not found', HttpStatus.NOT_FOUND);
      }
      const { participants, ...session } = row;
      const participant = participants[0];
      return {
        ...session,
        participation: participant
          ? {
              participantId: participant.id,
              enrollmentId: participant.enrollmentId,
              studentId,
              kind: participant.kind,
              attendance: participant.attendance,
              cancelled: participant.cancelled,
            }
          : null,
      };
    }
    const row = await this.db.classSession.findUnique({
      where: { id },
      include: {
        class: { include: { program: true } },
        teacher: { select: { id: true, displayName: true } },
        room: { select: { id: true, name: true } },
        lesson: {
          select: {
            id: true,
            title: true,
            content: true,
            sequence: true,
            kind: true,
            monthKey: true,
            unitId: true,
          },
        },
      },
    });
    this.assert(row, 'SESSION_NOT_FOUND', 'Session not found', HttpStatus.NOT_FOUND);
    if (user.role === 'TEACHER')
      this.assert(
        row.teacherId === user.id,
        'FORBIDDEN',
        'Session is not assigned to this teacher',
        HttpStatus.FORBIDDEN,
      );
    return row;
  }

  async generationList(user: AuthenticatedUser, classId: string): Promise<unknown> {
    this.requireRole(user, 'MANAGER', 'STAFF', 'TEACHER');
    if (user.role === 'TEACHER') {
      const classroom = await this.db.class.findUnique({ where: { id: classId } });
      this.assert(
        classroom && assignedTeacherAt(classroom, new Date()) === user.id,
        'FORBIDDEN',
        'Class is not assigned to this teacher',
        HttpStatus.FORBIDDEN,
      );
    }
    return this.db.scheduleGeneration.findMany({
      where: { classId },
      include: {
        unit: { select: { id: true, title: true, version: true, status: true } },
        _count: { select: { sessions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async generationDetail(user: AuthenticatedUser, id: string): Promise<unknown> {
    this.requireRole(user, 'MANAGER', 'STAFF', 'TEACHER');
    const row = await this.db.scheduleGeneration.findUnique({
      where: { id },
      include: {
        class: true,
        unit: true,
        sessions: { orderBy: { startsAt: 'asc' }, include: { lesson: true } },
      },
    });
    this.assert(row, 'GENERATION_NOT_FOUND', 'Generation not found', HttpStatus.NOT_FOUND);
    if (user.role === 'TEACHER')
      this.assert(
        assignedTeacherAt(row.class, new Date()) === user.id,
        'FORBIDDEN',
        'Class is not assigned to this teacher',
        HttpStatus.FORBIDDEN,
      );
    return row;
  }

  async reschedulePreview(
    user: AuthenticatedUser,
    id: string,
    input: SessionRescheduleDto,
  ): Promise<unknown> {
    this.requireRole(user, 'MANAGER');
    const result = await this.validateReschedule(this.db, id, input);
    return { sessionId: id, ...result };
  }

  async reschedule(
    user: AuthenticatedUser,
    id: string,
    input: SessionRescheduleDto,
    key: string | undefined,
  ): Promise<unknown> {
    this.requireRole(user, 'MANAGER');
    const idempotencyKey = key?.trim();
    this.assert(
      idempotencyKey && idempotencyKey.length <= 191,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key is required',
      HttpStatus.BAD_REQUEST,
    );
    const hash = createHash('sha256')
      .update(JSON.stringify({ actorId: user.id, action: 'reschedule', id, input }))
      .digest('hex');
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM class_sessions WHERE id = ${id} FOR UPDATE`;
      const prior = await tx.sessionMutation.findUnique({
        where: { sessionId_key: { sessionId: id, key: idempotencyKey } },
      });
      if (prior) {
        this.assert(
          prior.actorUserId === user.id && prior.requestHash === hash,
          'IDEMPOTENCY_CONFLICT',
          'Key was used for another change',
        );
        return prior.response;
      }
      const previousSession = await tx.classSession.findUnique({ where: { id } });
      this.assert(previousSession, 'SESSION_NOT_FOUND', 'Session not found', HttpStatus.NOT_FOUND);
      const { startsAt, endsAt, roomId } = await this.validateReschedule(tx, id, input);
      const result = await tx.classSession.update({
        where: { id },
        data: { startsAt, endsAt, roomId, revision: { increment: 1 } },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'CLASS_SESSION_RESCHEDULED',
          entityType: 'ClassSession',
          entityId: id,
          afterData: {
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            reason: input.reason.trim(),
          },
        },
      });
      await tx.sessionMutation.create({
        data: {
          sessionId: id,
          actorUserId: user.id,
          key: idempotencyKey,
          requestHash: hash,
          response: result,
        },
      });
      if (
        previousSession.startsAt.getTime() !== startsAt.getTime() ||
        previousSession.endsAt.getTime() !== endsAt.getTime() ||
        previousSession.roomId !== roomId
      )
        await this.notifications.session(
          tx,
          user.id,
          id,
          'SESSION_RESCHEDULED',
          `Lịch/phòng học của buổi ${input.startsAt} đã được cập nhật.`,
          `reschedule:${id}:${idempotencyKey}`,
          previousSession,
        );
      return result;
    });
  }

  async cancelSession(
    user: AuthenticatedUser,
    id: string,
    reason: string,
    expectedRevision: number,
    key: string | undefined,
  ): Promise<unknown> {
    this.requireRole(user, 'MANAGER');
    const idempotencyKey = key?.trim();
    this.assert(
      idempotencyKey && idempotencyKey.length <= 191,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key is required',
      HttpStatus.BAD_REQUEST,
    );
    const hash = createHash('sha256')
      .update(JSON.stringify({ actorId: user.id, action: 'cancel', id, reason, expectedRevision }))
      .digest('hex');
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM class_sessions WHERE id = ${id} FOR UPDATE`;
      const prior = await tx.sessionMutation.findUnique({
        where: { sessionId_key: { sessionId: id, key: idempotencyKey } },
      });
      if (prior) {
        this.assert(
          prior.actorUserId === user.id && prior.requestHash === hash,
          'IDEMPOTENCY_CONFLICT',
          'Key was used for another change',
        );
        return prior.response;
      }
      const session = await tx.classSession.findUnique({ where: { id } });
      this.assert(session, 'SESSION_NOT_FOUND', 'Session not found', HttpStatus.NOT_FOUND);
      this.assert(
        session.status === 'SCHEDULED' && session.startsAt > new Date(),
        'SESSION_LOCKED',
        'Only future scheduled sessions can be cancelled',
      );
      this.assert(
        session.revision === expectedRevision,
        'REVISION_CONFLICT',
        'Session changed; reload it',
      );
      const [bookings, attendance, leaves] = await Promise.all([
        tx.makeupBooking.count({
          where: {
            status: 'BOOKED',
            OR: [{ original: { sessionId: id } }, { replacement: { sessionId: id } }],
          },
        }),
        tx.sessionParticipant.count({ where: { sessionId: id, attendance: { not: 'UNMARKED' } } }),
        tx.leaveRequest.count({
          where: { sessionId: id, status: { in: ['PENDING', 'APPROVED'] } },
        }),
      ]);
      this.assert(!bookings, 'MAKEUP_BOOKING_EXISTS', 'Resolve makeup bookings before cancelling');
      this.assert(
        !attendance && !leaves,
        'SESSION_HAS_DEPENDENCIES',
        'Resolve attendance and leave records before cancelling',
      );
      const result = await tx.classSession.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelReason: reason.trim(),
          cancelledAt: new Date(),
          revision: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'CLASS_SESSION_CANCELLED',
          entityType: 'ClassSession',
          entityId: id,
          afterData: { reason: reason.trim() },
        },
      });
      await tx.sessionMutation.create({
        data: {
          sessionId: id,
          actorUserId: user.id,
          key: idempotencyKey,
          requestHash: hash,
          response: result,
        },
      });
      await this.notifications.session(
        tx,
        user.id,
        id,
        'SESSION_CANCELLED',
        `Buổi học đã bị huỷ: ${reason.trim()}`,
        `cancel:${id}:${idempotencyKey}`,
      );
      return result;
    });
  }

  private async validateReschedule(
    tx: Prisma.TransactionClient | DatabaseService,
    id: string,
    input: SessionRescheduleDto,
  ): Promise<{ startsAt: Date; endsAt: Date; roomId: string | null; conflicts: never[] }> {
    const session = await tx.classSession.findUnique({
      where: { id },
      include: {
        lesson: { include: { unit: true } },
        participants: { include: { enrollment: { include: { placements: true } } } },
        leaves: true,
      },
    });
    this.assert(session, 'SESSION_NOT_FOUND', 'Session not found', HttpStatus.NOT_FOUND);
    this.assert(
      session.status === 'SCHEDULED' && session.startsAt > new Date(),
      'SESSION_LOCKED',
      'Only future scheduled sessions can be moved',
    );
    this.assert(
      session.revision === input.expectedRevision,
      'REVISION_CONFLICT',
      'Session changed; reload it',
    );
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    this.assert(
      startsAt > new Date() && endsAt > startsAt,
      'INVALID_SESSION_TIME',
      'New time must be in the future and have a valid duration',
      HttpStatus.BAD_REQUEST,
    );
    const local = (date: Date): string =>
      new Date(date.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 10);
    this.assert(
      local(startsAt).slice(0, 7) === local(session.startsAt).slice(0, 7),
      'MONTH_CHANGE_NOT_SUPPORTED',
      'Move the session within its original month',
    );
    if (session.lesson.unit)
      this.assert(
        local(startsAt) >= dateOnly(session.lesson.unit.fromDate) &&
          local(startsAt) <= dateOnly(session.lesson.unit.toDate),
        'RANGE_OUTSIDE_UNIT',
        'New date is outside the curriculum unit',
      );
    const targetDay = localDate(local(startsAt));
    this.assert(
      session.participants
        .filter((row) => !row.cancelled && row.kind === 'REGULAR')
        .every((row) => {
          const enrollment = row.enrollment;
          if (
            !enrollment.startDate ||
            !enrollment.endDate ||
            enrollment.startDate > targetDay ||
            enrollment.endDate <= targetDay
          )
            return false;
          return enrollment.placements.length
            ? enrollment.placements.some(
                (placement) =>
                  placement.classId === session.classId &&
                  placement.effectiveFrom <= startsAt &&
                  (!placement.effectiveTo || placement.effectiveTo > startsAt),
              )
            : enrollment.classId === session.classId;
        }),
      'PARTICIPANT_OUTSIDE_TERM',
      'A rostered student is not placed in this class at the new time',
    );
    this.assert(
      session.participants.every((row) => row.attendance === 'UNMARKED') &&
        !session.leaves.some((row) => row.status === 'PENDING' || row.status === 'APPROVED'),
      'SESSION_HAS_DEPENDENCIES',
      'Resolve attendance and leave records before moving',
    );
    const roomId = input.roomId ?? session.roomId;
    if (roomId) {
      const room = await tx.room.findUnique({ where: { id: roomId } });
      this.assert(room?.isActive, 'INVALID_ROOM', 'Choose an active room');
      const classroom = await tx.class.findUniqueOrThrow({ where: { id: session.classId } });
      this.assert(
        room.capacity >= classroom.capacity,
        'ROOM_CAPACITY_EXCEEDED',
        'Room capacity must cover class capacity',
      );
    }
    const [bookings, conflicts] = await Promise.all([
      tx.makeupBooking.count({
        where: {
          status: 'BOOKED',
          OR: [{ original: { sessionId: id } }, { replacement: { sessionId: id } }],
        },
      }),
      tx.classSession.findMany({
        where: {
          id: { not: id },
          status: { not: 'CANCELLED' },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
          OR: [
            { classId: session.classId },
            { teacherId: session.teacherId },
            ...(roomId ? [{ roomId }] : []),
          ],
        },
        select: { id: true },
      }),
    ]);
    this.assert(!bookings, 'MAKEUP_BOOKING_EXISTS', 'Resolve makeup bookings before moving');
    this.assert(
      !conflicts.length,
      'SCHEDULE_CONFLICT',
      'Class or teacher has an overlapping session',
    );
    const ordered = await tx.classSession.findMany({
      where: { classId: session.classId, status: { not: 'CANCELLED' } },
      select: { id: true, startsAt: true, endsAt: true },
      orderBy: { startsAt: 'asc' },
    });
    const position = ordered.findIndex((row) => row.id === id);
    const previous = ordered[position - 1];
    const next = ordered[position + 1];
    this.assert(
      (!previous || startsAt >= previous.endsAt) && (!next || endsAt <= next.startsAt),
      'SESSION_ORDER_CONFLICT',
      'Moving this session would change lesson order',
    );
    return { startsAt, endsAt, roomId, conflicts: [] };
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
    this.assert(classroom.program.isActive, 'PROGRAM_INACTIVE', 'Program is inactive');
    this.assert(
      !classroom.program.subjectRecord || classroom.program.subjectRecord.isActive,
      'SUBJECT_INACTIVE',
      'Subject is inactive',
    );
    this.assert(
      input.fromDate >= dateOnly(unit.fromDate) && input.toDate <= dateOnly(unit.toDate),
      'RANGE_OUTSIDE_UNIT',
      'Requested dates are outside the unit',
    );
    this.assert(
      classroom.programId === unit.programId,
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
        OR: [
          { classId: classroom.id },
          { teacherId: { in: slotsTeacherIds(classroom, slots) } },
          ...(classroom.roomId ? [{ roomId: classroom.roomId }] : []),
        ],
      },
      select: {
        id: true,
        classId: true,
        teacherId: true,
        roomId: true,
        startsAt: true,
        endsAt: true,
      },
    });
    return rows.filter((row) =>
      slots.some(
        (slot) =>
          overlaps(slot, row) &&
          (row.classId === classroom.id ||
            row.teacherId === assignedTeacherAt(classroom, slot.startsAt) ||
            (classroom.roomId && row.roomId === classroom.roomId)),
      ),
    );
  }

  private scheduleSnapshot(unit: UnitWithLessons, classroom: ClassWithSchedule): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          unit: {
            id: unit.id,
            status: unit.status,
            revision: unit.revision,
            from: dateOnly(unit.fromDate),
            to: dateOnly(unit.toDate),
            lessons: unit.lessons
              .map((row) => ({
                id: row.id,
                kind: row.kind,
                sequence: row.sequence,
                monthKey: row.monthKey,
                status: row.status,
              }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          },
          classroom: {
            id: classroom.id,
            programId: classroom.programId,
            teacherId: classroom.teacherId,
            pendingTeacherId: classroom.pendingTeacherId,
            pendingTeacherFrom: classroom.pendingTeacherFrom,
            teacherStatus: classroom.teacher?.status,
            schedules: classroom.weeklySchedules
              .map((row) => ({
                weekday: row.weekday,
                startTime: row.startTime,
                endTime: row.endTime,
              }))
              .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)),
          },
        }),
      )
      .digest('hex');
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
      include: {
        program: { include: { subjectRecord: true } },
        weeklySchedules: true,
        teacher: true,
      },
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
        unit.status === 'APPROVED' || unit.status === 'ARCHIVED',
        'FORBIDDEN',
        'Unit is not approved',
        HttpStatus.FORBIDDEN,
      );
      const assigned = await this.db.class.findMany({
        where: { teacherId: user.id, programId: unit.programId },
        include: { program: true },
      });
      this.assert(
        assigned.length > 0,
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
