import { NotificationEventsService } from '../notifications/notification-events.service';
import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type Lesson } from '@prisma/client';
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
  SubmitCurriculumUnitDto,
  TechnicalReviewDto,
  ReviseCurriculumUnitDto,
} from './curriculum-scheduling.dto';
import type { ParentCurriculumResponseDto } from '../academic/parent-learning-response.dto';
import { pageResult } from '../../common/pagination';
import { dateTimeRange } from '../../common/list-query';
import {
  SearchPageDto,
  ClassContentQueryDto,
  ParentCurriculumQueryDto,
} from '../academic/academic-list.dto';
import { parentEnrollmentSelect, parentSessionWhere } from './parent-session-access';
import { MAX_CODES_PER_ROW, parseCurriculumCsv } from './curriculum-csv';
import { CsvFileError } from '../../common/csv/read-csv';
import { reviewerReason, reviewerTiers, subjectKey } from './reviewer-eligibility';
import { assertProgramFrequency } from '../registration-flow/program-frequency';
import {
  approvedPeriod,
  draftPeriod,
  lockCurriculumProgram,
  publishedCurriculumWhere,
  supersedeOtherCurricula,
} from './curriculum-lifecycle';
import {
  planLessonSlots,
  scheduleLimit,
  slotsForRange,
  vietnamDate,
  vietnamDayStart,
  type ClosureRange,
} from './session-lesson-plan';
import { tetBreaks } from '../../common/lunar-new-year';
import { SessionRowsRepository } from './session-rows.repository';
import { roleAllowed } from '../../common/auth/role-access';

// Seeds and older callers import the calendar helper from here.
export { slotsForRange } from './session-lesson-plan';

const DAY_MS = 86_400_000;
const HCM_OFFSET_MS = 7 * 3_600_000;
const unitInclude = {
  program: { select: { id: true, name: true, subject: true, grade: true, sessionsPerWeek: true } },
  track: true,
  reviewerTeacher: { select: { id: true, email: true, displayName: true } },
  lessons: {
    orderBy: [{ kind: 'asc' }, { sequence: 'asc' }],
    // Only the ids: enough for the "every lesson has a CLO" check.
    include: { outcomeLinks: { select: { outcomeId: true } } },
  },
} satisfies Prisma.CurriculumUnitInclude;

type UnitWithLessons = Prisma.CurriculumUnitGetPayload<{ include: typeof unitInclude }>;
type OutcomeLookup = { id: string; setId: string; ambiguous: boolean };
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
type PlanContext = {
  closures: ClosureRange[];
  anchorLessonId: string | null;
  anchorSequence: number | null;
};

function slotsTeacherIds(classroom: ClassWithSchedule, slots: PlannedSlot[]): string[] {
  return [...new Set(slots.map((slot) => assignedTeacherAt(classroom, slot.startsAt)))].filter(
    (id): id is string => !!id,
  );
}

@Injectable()
export class CurriculumSchedulingService {
  // Stateless SQL helpers; created here so existing callers keep the two-argument constructor.
  private readonly sessionRows = new SessionRowsRepository();

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationEventsService,
  ) {}

  async createUnit(user: AuthenticatedUser, input: CreateCurriculumUnitDto): Promise<unknown> {
    this.requireRole(user, 'CURRICULUM_DESIGNER');
    const program = await this.db.program.findUnique({ where: { id: input.programId } });
    // A program the ADMIN soft-deleted keeps `isActive`: it reads as not found, like in the list.
    this.assert(
      program && !program.deletedAt,
      'PROGRAM_NOT_FOUND',
      'Program not found',
      HttpStatus.NOT_FOUND,
    );
    this.assert(program.isActive, 'PROGRAM_INACTIVE', 'Program is inactive');
    await this.assertProgramHasOutcomes(this.db, program.id);
    if (program.subjectId) {
      const subject = await this.db.subject.findUnique({ where: { id: program.subjectId } });
      this.assert(
        subject?.isActive && !subject.deletedAt,
        'SUBJECT_INACTIVE',
        'Subject is inactive',
      );
    }
    const key = subjectKey(program.subject);
    const track = await this.db.curriculumTrack.upsert({
      where: { grade_subjectKey: { grade: program.grade, subjectKey: key } },
      create: { grade: program.grade, subjectKey: key, subject: program.subject.trim() },
      update: {},
    });
    return this.transaction(async (tx) => {
      await lockCurriculumProgram(tx, program.id);
      return tx.curriculumUnit.create({
        data: {
          trackId: track.id,
          programId: program.id,
          designerId: user.id,
          version: await this.nextVersion(tx, program.id),
          title: input.title.trim(),
          ...draftPeriod(),
        },
        include: unitInclude,
      });
    });
  }

  async studentCurriculum(
    user: AuthenticatedUser,
    studentId: string,
    page: ParentCurriculumQueryDto,
  ): Promise<ParentCurriculumResponseDto> {
    this.requireRole(user, 'PARENT');
    await this.assertParentStudent(user, studentId);
    dateTimeRange(page.fromDate, page.toDate);
    const now = new Date();
    const today = localDate(dateOnly(new Date(now.getTime() + HCM_OFFSET_MS)));
    // In-term and upcoming enrollments, so parents can preview the next term.
    const enrollments = await this.db.enrollment.findMany({
      where: {
        studentProfileId: studentId,
        status: 'ACTIVE',
        endDate: { gt: today },
      },
      select: {
        startDate: true,
        endDate: true,
        class: { select: { id: true, name: true, programId: true } },
        placements: {
          select: {
            effectiveFrom: true,
            effectiveTo: true,
            class: { select: { id: true, name: true, programId: true } },
          },
          orderBy: { effectiveFrom: 'asc' },
        },
      },
    });
    const scopes = enrollments.flatMap((enrollment) => {
      if (!enrollment.startDate || !enrollment.endDate) return [];
      // Class of an upcoming term: the placement that takes effect when the term starts.
      const at = enrollment.startDate > now ? enrollment.startDate : now;
      const placement = enrollment.placements.find(
        (item) => item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at),
      );
      const classroom =
        placement?.class ?? (enrollment.placements.length === 0 ? enrollment.class : null);
      return classroom
        ? [{ classroom, startDate: enrollment.startDate, endDate: enrollment.endDate }]
        : [];
    });
    const classesOfUnit = await this.unitsOfClasses(scopes.map((scope) => scope.classroom));
    if (!classesOfUnit.size)
      return { studentId, items: [], page: page.page, limit: page.limit, total: 0 };
    const where: Prisma.CurriculumUnitWhereInput = {
      AND: [publishedCurriculumWhere, { id: { in: [...classesOfUnit.keys()] } }],
      ...(page.programId ? { programId: page.programId } : {}),
      ...(page.search ? { title: { contains: page.search } } : {}),
      ...(page.toDate ? { fromDate: { lte: new Date(page.toDate) } } : {}),
      ...(page.fromDate ? { toDate: { gte: new Date(page.fromDate) } } : {}),
      program: {
        ...(page.subject ? { subject: page.subject } : {}),
        ...(page.grade ? { grade: page.grade } : {}),
      },
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
      items: units.map((unit) => ({ ...unit, classes: classesOfUnit.get(unit.id) ?? [] })),
    };
  }

  /**
   * The curriculum version each class teaches (Đợt F): the version of its latest session, or
   * the program's approved version while the class has no session yet. Keyed by unit id.
   */
  private async unitsOfClasses(
    classes: Array<{ id: string; name: string; programId: string }>,
  ): Promise<Map<string, Array<{ id: string; name: string }>>> {
    const classIds = [...new Set(classes.map((item) => item.id))];
    const taught = await this.db.classSession.findMany({
      where: { classId: { in: classIds }, status: { not: 'CANCELLED' } },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      distinct: ['classId'],
      select: { classId: true, lesson: { select: { unitId: true } } },
    });
    const unitOfClass = new Map(
      taught.flatMap((row) =>
        row.lesson.unitId ? [[row.classId, row.lesson.unitId] as const] : [],
      ),
    );
    const waiting = [
      ...new Set(classes.filter((item) => !unitOfClass.has(item.id)).map((item) => item.programId)),
    ];
    const current = waiting.length
      ? await this.db.curriculumUnit.findMany({
          where: { programId: { in: waiting }, status: 'APPROVED' },
          orderBy: [{ fromDate: 'desc' }, { version: 'desc' }, { id: 'desc' }],
          select: { id: true, programId: true },
        })
      : [];
    const currentOfProgram = new Map<string, string>();
    for (const unit of current)
      if (!currentOfProgram.has(unit.programId)) currentOfProgram.set(unit.programId, unit.id);
    const result = new Map<string, Array<{ id: string; name: string }>>();
    for (const item of classes) {
      const unitId = unitOfClass.get(item.id) ?? currentOfProgram.get(item.programId);
      if (!unitId) continue;
      const list = result.get(unitId) ?? [];
      if (!list.some((row) => row.id === item.id)) list.push({ id: item.id, name: item.name });
      result.set(unitId, list);
    }
    return result;
  }

  async listUnits(user: AuthenticatedUser, filter: CurriculumUnitFilterDto): Promise<unknown> {
    this.requireRole(user, 'CURRICULUM_DESIGNER', 'MANAGER', 'TEACHER');
    dateTimeRange(filter.fromDate, filter.toDate);
    const teacherPrograms =
      user.role === 'TEACHER'
        ? (
            await this.db.class.findMany({
              where: assignedTeacherWhere(user.id, new Date()),
              include: { program: true },
            })
          ).map((row) => row.programId)
        : [];
    const program = filter.programId
      ? await this.db.program.findUnique({ where: { id: filter.programId } })
      : null;
    if (filter.programId)
      this.assert(program, 'PROGRAM_NOT_FOUND', 'Program not found', HttpStatus.NOT_FOUND);
    // Every curriculum designer lists every curriculum (Q6): drafts are shared, not owned.
    const where: Prisma.CurriculumUnitWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(user.role === 'TEACHER'
        ? {
            OR: [
              { status: 'PENDING_REVIEW', reviewerTeacherId: user.id },
              { programId: { in: teacherPrograms }, ...publishedCurriculumWhere },
            ],
          }
        : {}),
      ...(program ? { programId: program.id } : {}),
      track: {
        ...(filter.grade ? { grade: filter.grade } : {}),
        ...(filter.subject ? { subjectKey: subjectKey(filter.subject) } : {}),
      },
      ...(filter.search ? { title: { contains: filter.search.trim() } } : {}),
      ...(filter.toDate ? { fromDate: { lte: new Date(filter.toDate) } } : {}),
      ...(filter.fromDate ? { toDate: { gte: new Date(filter.fromDate) } } : {}),
    };
    const include = {
      track: true,
      reviewerTeacher: unitInclude.reviewerTeacher,
      program: {
        select: { id: true, name: true, subject: true, grade: true, sessionsPerWeek: true },
      },
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
      skip: (page - 1) * limit,
      take: limit,
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
      // fromDate/toDate are ignored: the period is set when the manager approves (Đợt F).
      return tx.curriculumUnit.update({
        where: { id },
        data: {
          ...(input.title === undefined ? {} : { title: input.title.trim() }),
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
    const unit = await this.loadUnit(id);
    this.assertEditable(user, unit);
    this.checkRevision(unit, input.expectedRevision);
    throw new AppError(
      'TESTS_MANAGED_BY_TEACHER',
      'Teachers create assignments and tests separately from the curriculum',
      HttpStatus.CONFLICT,
    );
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
      this.assert(
        lesson.kind === 'LESSON',
        'TESTS_MANAGED_BY_TEACHER',
        'Historical tests remain separate from editable curriculum lessons',
      );
      const [sessions, feedback] = await Promise.all([
        tx.classSession.count({ where: { lessonId } }),
        tx.curriculumFeedback.count({
          where: { OR: [{ lessonId }, { resolutionLessonId: lessonId }] },
        }),
      ]);
      this.assert(!sessions && !feedback, 'LESSON_IN_USE', 'Lesson has dependent history');
      // CLO links are mapping data, not history; the FK would otherwise refuse the delete.
      await tx.lessonOutcome.deleteMany({ where: { lessonId } });
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
      'Upload a CSV or Excel (.xlsx) file',
      HttpStatus.BAD_REQUEST,
    );
    let rows;
    try {
      rows = await parseCurriculumCsv(file.buffer, file.originalname ?? 'import.csv');
    } catch (error) {
      throw new AppError(
        'CSV_INVALID',
        error instanceof Error ? error.message : 'Invalid file',
        HttpStatus.BAD_REQUEST,
        error instanceof CsvFileError ? error.details() : undefined,
      );
    }
    const known = await this.programOutcomeCodes(this.db, unit.programId, rows);
    const errors = this.importErrors(unit, rows, mode, known);
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
        outcomeCodes?: string[];
      }>;
      const rowValues = (row: {
        rowNumber: number;
        kind: string;
        sequence?: number | null;
        title: string;
        content: string;
        monthKey?: string | null;
        outcomeCodes?: string[];
      }): unknown[] => [
        row.rowNumber,
        row.kind,
        row.sequence ?? null,
        row.title,
        row.content,
        row.monthKey ?? null,
        row.outcomeCodes ?? [],
      ];
      this.assert(
        JSON.stringify(previewRows.map(rowValues)) === JSON.stringify(input.rows.map(rowValues)),
        'IMPORT_PREVIEW_STALE',
        'Import rows differ from the preview; preview again',
      );
      const known = await this.programOutcomeCodes(tx, unit.programId, input.rows);
      const errors = this.importErrors(unit, input.rows, input.mode, known);
      this.assert(
        !errors.some((error) => error.code === 'TESTS_MANAGED_BY_TEACHER'),
        'TESTS_MANAGED_BY_TEACHER',
        'Teachers create assignments and tests separately from the curriculum',
        HttpStatus.BAD_REQUEST,
      );
      this.assert(
        !errors.length,
        'INVALID_IMPORT',
        `Import has ${errors.length} validation errors`,
        HttpStatus.BAD_REQUEST,
      );
      // Lock every set whose links change (old links of a replaced unit and new ones) first.
      const lockIds = input.rows.flatMap((row) =>
        (row.outcomeCodes ?? []).map((code) => known.get(code.toUpperCase())!.setId),
      );
      if (input.mode === 'REPLACE') {
        const old = await tx.lessonOutcome.findMany({
          where: { lesson: { unitId: id, kind: 'LESSON' } },
          select: { outcome: { select: { outcomeSetId: true } } },
        });
        lockIds.push(...old.map((link) => link.outcome.outcomeSetId));
      }
      await this.lockOutcomeSets(tx, lockIds);
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
        await tx.lessonOutcome.deleteMany({ where: { lesson: { unitId: id, kind: 'LESSON' } } });
        await tx.lesson.deleteMany({ where: { unitId: id, kind: 'LESSON' } });
      }
      await tx.lesson.createMany({
        data: input.rows.map((row) => ({
          unitId: id,
          programId: unit.programId,
          designerId: user.id,
          kind: row.kind,
          sequence: row.sequence!,
          monthKey: null,
          title: row.title.trim(),
          content: row.content.trim(),
        })),
      });
      await this.linkImportedOutcomes(tx, id, input.rows, known);
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

  /**
   * Resolves CLO codes (upper-cased) against the program's APPROVED, else DRAFT, sets: per code the
   * newest set version wins (then id). A code found at that status in sets of different levels
   * is ambiguous and becomes a row error, so preview and commit always agree.
   */
  private async programOutcomeCodes(
    client: Pick<Prisma.TransactionClient, 'learningOutcome'>,
    programId: string,
    rows: Array<{ outcomeCodes?: string[] }>,
  ): Promise<Map<string, OutcomeLookup>> {
    // Legacy files carry no codes: skip the lookup.
    if (!rows.some((row) => row.outcomeCodes?.length)) return new Map();
    const outcomes = await client.learningOutcome.findMany({
      where: { outcomeSet: { programId, status: { in: ['DRAFT', 'APPROVED'] } } },
      select: {
        id: true,
        code: true,
        outcomeSetId: true,
        outcomeSet: { select: { status: true, version: true, level: true } },
      },
    });
    const byCode = new Map<string, typeof outcomes>();
    for (const outcome of outcomes) {
      const key = outcome.code.toUpperCase();
      byCode.set(key, [...(byCode.get(key) ?? []), outcome]);
    }
    const known = new Map<string, OutcomeLookup>();
    for (const [key, found] of byCode) {
      const approved = found.filter((item) => item.outcomeSet.status === 'APPROVED');
      const pool = approved.length ? approved : found;
      const [newest] = [...pool].sort(
        (a, b) =>
          b.outcomeSet.version - a.outcomeSet.version ||
          a.outcomeSetId.localeCompare(b.outcomeSetId),
      );
      known.set(key, {
        id: newest.id,
        setId: newest.outcomeSetId,
        ambiguous: new Set(pool.map((item) => item.outcomeSet.level)).size > 1,
      });
    }
    return known;
  }

  /** Locks outcome sets in one fixed order, like setLessonOutcomes, so a concurrent approval waits. */
  private async lockOutcomeSets(tx: Prisma.TransactionClient, setIds: string[]): Promise<void> {
    for (const setId of [...new Set(setIds)].sort())
      await tx.$queryRaw`SELECT id FROM outcome_sets WHERE id = ${setId} FOR UPDATE`;
  }

  /**
   * Links the lessons created by an import to their CLOs, with the setLessonOutcomes rules: CLOs
   * of the unit's own program, new lessons are DRAFT. The sets are already locked by the caller.
   */
  private async linkImportedOutcomes(
    tx: Prisma.TransactionClient,
    unitId: string,
    rows: Array<{ sequence?: number | null; outcomeCodes?: string[] }>,
    known: Map<string, OutcomeLookup>,
  ): Promise<void> {
    const wanted = rows
      .filter((row) => row.sequence != null && row.outcomeCodes?.length)
      .map((row) => ({
        sequence: row.sequence as number,
        outcomeIds: (row.outcomeCodes ?? []).map((code) => known.get(code.toUpperCase())!.id),
      }));
    if (!wanted.length) return;
    const lessons = await tx.lesson.findMany({
      where: { unitId, kind: 'LESSON', sequence: { in: wanted.map((item) => item.sequence) } },
      select: { id: true, sequence: true },
    });
    const lessonAt = new Map(lessons.map((lesson) => [lesson.sequence, lesson.id]));
    await tx.lessonOutcome.createMany({
      data: wanted.flatMap((item) => {
        const lessonId = lessonAt.get(item.sequence);
        return lessonId
          ? [...new Set(item.outcomeIds)].map((outcomeId) => ({ lessonId, outcomeId }))
          : [];
      }),
      skipDuplicates: true,
    });
  }

  private importErrors(
    unit: UnitWithLessons,
    rows: Array<ImportRowDto | Awaited<ReturnType<typeof parseCurriculumCsv>>[number]>,
    mode: string,
    known: Map<string, OutcomeLookup>,
  ): Array<{ rowNumber: number; field: string; code: string; codes?: string[] }> {
    const errors: Array<{ rowNumber: number; field: string; code: string; codes?: string[] }> = [];
    const lessonStart =
      mode === 'APPEND' ? unit.lessons.filter((row) => row.kind === 'LESSON').length + 1 : 1;
    let expected = lessonStart;
    for (const row of rows) {
      if (row.kind !== 'LESSON')
        errors.push({
          rowNumber: row.rowNumber,
          field: 'kind',
          code: row.kind === 'MONTHLY_TEST' ? 'TESTS_MANAGED_BY_TEACHER' : 'INVALID_KIND',
        });
      if (!row.title?.trim() || row.title.length > 255)
        errors.push({ rowNumber: row.rowNumber, field: 'title', code: 'INVALID_TITLE' });
      if (!row.content?.trim() || row.content.length > 50000)
        errors.push({ rowNumber: row.rowNumber, field: 'content', code: 'INVALID_CONTENT' });
      const codes = row.outcomeCodes ?? [];
      const unknown = codes.filter((code) => !known.has(code.toUpperCase()));
      const ambiguous = codes.filter((code) => known.get(code.toUpperCase())?.ambiguous);
      if (codes.length > MAX_CODES_PER_ROW)
        errors.push({
          rowNumber: row.rowNumber,
          field: 'outcomeCodes',
          code: 'TOO_MANY_OUTCOME_CODES',
        });
      else if (unknown.length)
        errors.push({
          rowNumber: row.rowNumber,
          field: 'outcomeCodes',
          code: 'UNKNOWN_OUTCOME_CODE',
          codes: unknown,
        });
      else if (ambiguous.length)
        errors.push({
          rowNumber: row.rowNumber,
          field: 'outcomeCodes',
          code: 'AMBIGUOUS_OUTCOME_CODE',
          codes: ambiguous,
        });
      if (row.kind === 'LESSON') {
        if (row.sequence !== expected)
          errors.push({ rowNumber: row.rowNumber, field: 'sequence', code: 'INVALID_SEQUENCE' });
        expected++;
      }
    }
    return errors;
  }

  async submitUnit(
    user: AuthenticatedUser,
    id: string,
    input: SubmitCurriculumUnitDto,
  ): Promise<unknown> {
    return this.transaction(async (tx) => {
      const unit = await this.lockEditableUnit(tx, user, id);
      this.validateDraft(unit);
      await this.assertResponsibleReviewer(tx, input.reviewerTeacherId, unit.programId);
      const result = await tx.curriculumUnit.update({
        where: { id },
        data: {
          status: 'PENDING_REVIEW',
          submittedAt: new Date(),
          reviewNote: null,
          reviewedAt: null,
          reviewedById: null,
          reviewerTeacherId: input.reviewerTeacherId,
          technicalReviewedAt: null,
          technicalReviewNote: null,
          revision: { increment: 1 },
        },
        include: unitInclude,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'CURRICULUM_UNIT_SUBMITTED',
          entityType: 'CurriculumUnit',
          entityId: id,
          afterData: { reviewerTeacherId: input.reviewerTeacherId },
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

  async reviewers(
    user: AuthenticatedUser,
    id: string,
    query = new SearchPageDto(),
  ): Promise<unknown> {
    this.requireRole(user, 'MANAGER', 'CURRICULUM_DESIGNER');
    const unit = await this.loadUnit(id);
    await this.canReadUnit(user, unit);
    // Groups come from the unfiltered candidates, so a search never switches the list to ANY.
    const tiers = await reviewerTiers(this.db, unit.programId, new Date());
    const where: Prisma.UserWhereInput = {
      role: 'TEACHER',
      status: 'ACTIVE',
      // Teachers soft-deleted by the ADMIN never show up as reviewers.
      deletedAt: null,
      ...(query.search
        ? {
            OR: [
              { displayName: { contains: query.search } },
              { email: { contains: query.search } },
            ],
          }
        : {}),
    };
    const select = { id: true, email: true, displayName: true } as const;
    const orderBy: Prisma.UserOrderByWithRelationInput[] = [
      { displayName: 'asc' },
      { email: 'asc' },
      { id: 'asc' },
    ];
    if (!tiers.program.size && !tiers.subject.size)
      return pageResult(
        query,
        this.db.user
          .findMany({
            where,
            select,
            orderBy,
            take: query.limit,
            skip: (query.page - 1) * query.limit,
          })
          .then((rows) => rows.map((row) => ({ ...row, reason: 'ANY' as const }))),
        () => this.db.user.count({ where }),
      );
    // A center has few teachers, so both groups are ranked in memory: PROGRAM first, then SUBJECT.
    const rows = await this.db.user.findMany({
      where: { ...where, id: { in: [...tiers.program, ...tiers.subject] } },
      select,
      orderBy,
    });
    const ranked = [
      ...rows
        .filter((row) => tiers.program.has(row.id))
        .map((row) => ({ ...row, reason: 'PROGRAM' as const })),
      ...rows
        .filter((row) => tiers.subject.has(row.id))
        .map((row) => ({ ...row, reason: 'SUBJECT' as const })),
    ];
    const skip = (query.page - 1) * query.limit;
    return pageResult(query, Promise.resolve(ranked.slice(skip, skip + query.limit)), () =>
      Promise.resolve(ranked.length),
    );
  }

  async technicalReview(
    user: AuthenticatedUser,
    id: string,
    input: TechnicalReviewDto,
  ): Promise<unknown> {
    this.requireRole(user, 'TEACHER');
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM curriculum_units WHERE id = ${id} FOR UPDATE`;
      const unit = await tx.curriculumUnit.findUnique({ where: { id }, include: unitInclude });
      this.assert(unit, 'UNIT_NOT_FOUND', 'Curriculum unit not found', HttpStatus.NOT_FOUND);
      this.assert(
        unit.reviewerTeacherId === user.id,
        'FORBIDDEN',
        'Only the selected teacher can review this curriculum',
        HttpStatus.FORBIDDEN,
      );
      this.assert(
        unit.status === 'PENDING_REVIEW' && !unit.technicalReviewedAt,
        'UNIT_NOT_PENDING_TECHNICAL_REVIEW',
        'Curriculum is not awaiting a teacher review',
      );
      this.checkRevision(unit, input.expectedRevision);
      // Eligibility was checked at submission. Re-checking the groups here would lock out a
      // teacher chosen from ANY as soon as the program gets its own teacher.
      const reviewer = await tx.user.findFirst({
        where: { id: user.id, role: 'TEACHER', status: 'ACTIVE' },
        select: { id: true },
      });
      this.assert(reviewer, 'FORBIDDEN', 'Reviewer account is not active', HttpStatus.FORBIDDEN);
      const note = input.note?.trim() || null;
      this.assert(
        input.approved || note,
        'REVIEW_NOTE_REQUIRED',
        'Explain the changes required before returning the curriculum',
        HttpStatus.BAD_REQUEST,
      );
      if (input.approved) this.validateDraft(unit);
      const result = await tx.curriculumUnit.update({
        where: { id },
        data: {
          status: input.approved ? 'PENDING_REVIEW' : 'DRAFT',
          technicalReviewedAt: input.approved ? new Date() : null,
          technicalReviewNote: note,
          revision: { increment: 1 },
        },
        include: unitInclude,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: input.approved
            ? 'CURRICULUM_TECHNICAL_REVIEW_APPROVED'
            : 'CURRICULUM_TECHNICAL_CHANGES_REQUESTED',
          entityType: 'CurriculumUnit',
          entityId: id,
          afterData: { approved: input.approved, note },
        },
      });
      await this.notifications.curriculum(
        tx,
        user.id,
        id,
        input.approved ? 'CURRICULUM_SUBMITTED' : 'CURRICULUM_CHANGES_REQUESTED',
        input.approved
          ? 'Giáo trình đã qua duyệt chuyên môn, đang chờ quản lý.'
          : 'Giáo trình cần sửa theo phản hồi chuyên môn.',
        `CURRICULUM_TECHNICAL_REVIEW:${id}:${unit.revision}`,
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
          technicalReviewedAt: null,
          technicalReviewNote: null,
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
    const programId = await this.unitProgramId(id);
    return this.transaction(async (tx) => {
      await lockCurriculumProgram(tx, programId);
      await tx.$queryRaw`SELECT id FROM curriculum_units WHERE id = ${id} FOR UPDATE`;
      const unit = await tx.curriculumUnit.findUnique({ where: { id } });
      this.assert(unit, 'UNIT_NOT_FOUND', 'Curriculum unit not found', HttpStatus.NOT_FOUND);
      if (unit.status === 'APPROVED' || unit.status === 'ARCHIVED') {
        this.requireRole(user, 'MANAGER');
        if (unit.status === 'ARCHIVED') return unit;
        const archived = await tx.curriculumUnit.update({
          where: { id },
          data: {
            status: 'ARCHIVED',
            archivedAt: new Date(),
            archiveReason: 'MANUAL',
            supersededById: null,
            revision: { increment: 1 },
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            action: 'CURRICULUM_UNIT_ARCHIVED',
            entityType: 'CurriculumUnit',
            entityId: id,
            beforeData: { status: unit.status },
            afterData: { status: 'ARCHIVED', archiveReason: 'MANUAL' },
          },
        });
        return archived;
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
      await tx.lessonOutcome.deleteMany({ where: { lesson: { unitId: id } } });
      await tx.lesson.deleteMany({ where: { unitId: id } });
      await tx.curriculumUnit.delete({ where: { id } });
      return { id, deleted: true };
    });
  }

  private validateDraft(unit: UnitWithLessons): void {
    const first = this.draftErrors(unit)[0];
    if (first)
      this.assert(
        false,
        first.code,
        first.message,
        HttpStatus.CONFLICT,
        first.lessonIds ? { lessonIds: first.lessonIds } : undefined,
      );
  }

  /** A curriculum is written against CLOs: the program needs a CLO set with at least one outcome. */
  private async assertProgramHasOutcomes(
    db: Pick<Prisma.TransactionClient, 'outcomeSet'>,
    programId: string,
  ): Promise<void> {
    const sets = await db.outcomeSet.count({
      where: {
        programId,
        status: { in: ['DRAFT', 'APPROVED'] },
        outcomes: { some: {} },
      },
    });
    this.assert(
      sets > 0,
      'OUTCOMES_REQUIRED',
      'Create the course learning outcomes (CLO) before the curriculum',
    );
  }

  private checkRevision(unit: UnitWithLessons, expectedRevision?: number): void {
    if (expectedRevision !== undefined)
      this.assert(
        unit.revision === expectedRevision,
        'REVISION_CONFLICT',
        'Draft changed; reload it',
      );
  }

  private draftErrors(
    unit: UnitWithLessons,
  ): Array<{ code: string; message: string; lessonIds?: string[] }> {
    const errors: Array<{ code: string; message: string; lessonIds?: string[] }> = [];
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
    // Units that are already approved or archived keep their history: no new rule for them.
    if (unit.status === 'DRAFT' || unit.status === 'PENDING_REVIEW') {
      const lessonIds = regular
        .filter((lesson) => !lesson.outcomeLinks?.length)
        .map((lesson) => lesson.id);
      if (lessonIds.length)
        errors.push({
          code: 'LESSON_OUTCOME_MISSING',
          message: 'Every lesson must be linked to at least one CLO',
          lessonIds,
        });
    }
    return errors;
  }

  async approveUnit(user: AuthenticatedUser, id: string): Promise<unknown> {
    this.requireRole(user, 'MANAGER');
    const programId = await this.unitProgramId(id);
    return this.transaction(async (tx) => {
      await lockCurriculumProgram(tx, programId);
      await tx.$queryRaw`SELECT id FROM curriculum_units WHERE id = ${id} FOR UPDATE`;
      // Lock the lessons so the CLO-link check below reads committed links, not a stale snapshot.
      await tx.$queryRaw`SELECT id FROM lessons WHERE unitId = ${id} FOR UPDATE`;
      const unit = await tx.curriculumUnit.findUnique({ where: { id }, include: unitInclude });
      this.assert(unit, 'UNIT_NOT_FOUND', 'Curriculum unit not found', HttpStatus.NOT_FOUND);
      this.assert(
        unit.status === 'PENDING_REVIEW',
        'UNIT_NOT_PENDING',
        'Submit the unit before approval',
      );
      this.assert(
        unit.reviewerTeacherId && unit.technicalReviewedAt,
        'TECHNICAL_REVIEW_REQUIRED',
        'The selected teacher must approve the curriculum before manager confirmation',
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
      this.validateDraft(unit);
      await tx.lesson.updateMany({
        where: { unitId: id, kind: 'LESSON' },
        data: { status: 'APPROVED' },
      });
      // The new version applies from today; every other approved version stops now (Đợt F).
      // Supersede first, so the old version's period ends before this one takes its dates.
      const now = new Date();
      await supersedeOtherCurricula(tx, { id, programId }, user.id, now);
      await tx.curriculumUnit.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedAt: now,
          reviewedAt: now,
          reviewedById: user.id,
          ...approvedPeriod(now),
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
      return tx.curriculumUnit.findUniqueOrThrow({ where: { id }, include: unitInclude });
    });
  }

  async reviseUnit(
    user: AuthenticatedUser,
    id: string,
    input: ReviseCurriculumUnitDto,
  ): Promise<unknown> {
    this.requireRole(user, 'CURRICULUM_DESIGNER');
    const programId = await this.unitProgramId(id);
    return this.transaction(async (tx) => {
      await lockCurriculumProgram(tx, programId);
      await tx.$queryRaw`SELECT id FROM curriculum_units WHERE id = ${id} FOR UPDATE`;
      const unit = await tx.curriculumUnit.findUnique({ where: { id }, include: unitInclude });
      this.assert(unit, 'UNIT_NOT_FOUND', 'Curriculum unit not found', HttpStatus.NOT_FOUND);
      this.assert(
        unit.status === 'APPROVED' || (unit.status === 'ARCHIVED' && !!unit.approvedAt),
        'UNIT_NOT_APPROVED',
        'Only a previously approved unit can be revised',
      );
      await this.assertProgramHasOutcomes(tx, unit.programId);
      // The new version replaces this one when the manager approves it (Đợt F).
      const copy = await tx.curriculumUnit.create({
        data: {
          trackId: unit.trackId,
          programId: unit.programId,
          designerId: user.id,
          basedOnId: id,
          version: await this.nextVersion(tx, unit.programId),
          title: input.title.trim(),
          ...draftPeriod(),
        },
      });
      await tx.lesson.createMany({
        data: unit.lessons
          .filter((lesson) => lesson.kind === 'LESSON')
          .map((lesson) => ({
            unitId: copy.id,
            programId: unit.programId,
            designerId: user.id,
            title: lesson.title,
            content: lesson.content,
            sequence: lesson.sequence,
            kind: 'LESSON',
          })),
      });
      // Keep each lesson's CLO links so a new period does not lose its outcome mapping.
      const taught = unit.lessons.filter((lesson) => lesson.kind === 'LESSON');
      const links = await tx.lessonOutcome.findMany({
        where: { lessonId: { in: taught.map((lesson) => lesson.id) } },
      });
      if (links.length) {
        const sequenceOf = new Map(taught.map((lesson) => [lesson.id, lesson.sequence]));
        const copied = await tx.lesson.findMany({
          where: { unitId: copy.id, kind: 'LESSON' },
          select: { id: true, sequence: true },
        });
        const lessonAt = new Map(copied.map((lesson) => [lesson.sequence, lesson.id]));
        await tx.lessonOutcome.createMany({
          data: links.flatMap((link) => {
            const lessonId = lessonAt.get(sequenceOf.get(link.lessonId) ?? -1);
            return lessonId ? [{ lessonId, outcomeId: link.outcomeId }] : [];
          }),
          skipDuplicates: true,
        });
      }
      return tx.curriculumUnit.findUniqueOrThrow({
        where: { id: copy.id },
        include: unitInclude,
      });
    });
  }

  async preview(
    user: AuthenticatedUser,
    classId: string,
    input: ScheduleRangeDto,
  ): Promise<unknown> {
    this.requireRole(user, 'MANAGER');
    const [unit, classroom] = await Promise.all([
      this.loadUnit(input.curriculumUnitId ?? (await this.scheduleUnitId(this.db, classId))),
      this.loadClass(classId),
    ]);
    const context = await this.planContext(this.db, classId, unit, input.fromDate, false);
    const outlook = this.planWithOutlook(unit, classroom, input, context);
    const slots = outlook.slots;
    const conflicts = await this.findConflicts(this.db, classroom, slots);
    const savedPreview = await this.db.schedulePreview.create({
      data: {
        classId,
        unitId: unit.id,
        actorUserId: user.id,
        fromDate: localDate(input.fromDate),
        toDate: localDate(outlook.endDate),
        snapshotHash: this.scheduleSnapshot(unit, classroom, context),
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
      endDate: outlook.endDate,
      toDate: outlook.endDate,
      lessonCount: outlook.lessonCount,
      // CONTINUE: follows the class's last lesson of this unit (C4); FIRST_LESSON: starts at
      // lesson 1. The schedule always runs to the last lesson (D1).
      mode: context.anchorSequence === null ? 'FIRST_LESSON' : 'CONTINUE',
      startLesson: outlook.startLesson && lessonRef(outlook.startLesson),
      unscheduledLessons: [],
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
        }),
      )
      .digest('hex');
    const programHint = await this.db.class.findUnique({
      where: { id: classId },
      select: { programId: true },
    });
    this.assert(programHint, 'CLASS_NOT_FOUND', 'Class not found', HttpStatus.NOT_FOUND);
    return this.transaction(async (tx) => {
      await lockCurriculumProgram(tx, programHint.programId);
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
      // Resolved after the program and class locks, like the anchor below.
      const unitId = input.curriculumUnitId ?? (await this.scheduleUnitId(tx, classId));
      const [unit, classroom] = await Promise.all([
        tx.curriculumUnit.findUnique({
          where: { id: unitId },
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
      // Read after the program and class locks, so the anchor lesson cannot change under this
      // generation.
      const context = await this.planContext(tx, classId, unit, input.fromDate, true);
      const outlook = this.planWithOutlook(unit, classroom, input, context);
      const slots = outlook.slots;
      if (input.previewId) {
        const preview = await tx.schedulePreview.findUnique({ where: { id: input.previewId } });
        this.assert(
          preview &&
            preview.actorUserId === user.id &&
            preview.classId === classId &&
            preview.unitId === unit.id &&
            dateOnly(preview.fromDate) === input.fromDate &&
            dateOnly(preview.toDate) === outlook.endDate &&
            preview.expiresAt > new Date() &&
            preview.snapshotHash === this.scheduleSnapshot(unit, classroom, context),
          'PREVIEW_STALE',
          'Schedule preview is stale; preview again',
        );
      }
      const teacherIds = [...new Set(slotsTeacherIds(classroom, slots))];
      for (const teacherId of teacherIds) {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${teacherId} FOR UPDATE`;
      }
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
          toDate: localDate(outlook.endDate),
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
        `Lớp ${classroom.name}: đã xếp ${slots.length} buổi từ ${input.fromDate} đến ${outlook.endDate}.`,
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
        {
          ...(query.status ? { status: query.status } : {}),
          ...(query.teacherId ? { teacherId: query.teacherId } : {}),
          ...(query.roomId ? { roomId: query.roomId } : {}),
          ...(query.lessonId ? { lessonId: query.lessonId } : {}),
          ...(query.search
            ? {
                OR: [
                  { lesson: { title: { contains: query.search.trim() } } },
                  { class: { name: { contains: query.search.trim() } } },
                ],
              }
            : {}),
        },
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
            outcomeLinks: {
              select: { outcome: { select: { id: true, code: true, title: true } } },
              orderBy: { outcome: { code: 'asc' } },
            },
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
    if (!row.lesson) return row;
    // Additive: the CLOs of the lesson, for the assignment editor to prefill from.
    const { outcomeLinks, ...lesson } = row.lesson;
    return { ...row, lesson: { ...lesson, outcomes: outcomeLinks.map((link) => link.outcome) } };
  }

  async generationList(
    user: AuthenticatedUser,
    classId: string,
    query = new ClassContentQueryDto(),
  ): Promise<unknown> {
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
    const where: Prisma.ScheduleGenerationWhereInput = {
      AND: [
        { classId },
        {
          ...(query.classId ? { classId: query.classId } : {}),
          ...(query.search ? { unit: { title: { contains: query.search } } } : {}),
          createdAt: dateTimeRange(query.fromDate, query.toDate),
        },
      ],
    };
    return pageResult(
      query,
      this.db.scheduleGeneration.findMany({
        where,
        include: {
          unit: { select: { id: true, title: true, version: true, status: true } },
          _count: { select: { sessions: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: query.limit,
        skip: (query.page - 1) * query.limit,
      }),
      () => this.db.scheduleGeneration.count({ where }),
    );
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

  /**
   * Inputs of `plan`: the Tết breaks over the unit term and the lesson of the class's last
   * session of this unit (C4). Load after locking the class.
   * `lock`: read the anchor with `FOR UPDATE` (generate). A plain read inside a TiDB
   * pessimistic transaction uses the snapshot from before the class lock was granted, so it
   * could miss a change that committed while this transaction waited.
   */
  private async planContext(
    db: Prisma.TransactionClient,
    classId: string,
    unit: UnitWithLessons,
    fromDate: string,
    lock: boolean,
  ): Promise<PlanContext> {
    // Tết breaks over the real span of the schedule (start date + 24 months), not the unit term.
    const closures = tetBreaks(fromDate, scheduleLimit(fromDate));
    const last = lock
      ? await this.lockedAnchor(db, classId, unit)
      : await this.anchor(db, classId, unit);
    if (last)
      this.assert(
        last.startsAt < vietnamDayStart(fromDate),
        'SESSIONS_AFTER_RANGE_EXIST',
        'The class already has sessions of this curriculum on or after fromDate',
        HttpStatus.CONFLICT,
        { lastScheduledDate: vietnamDate(last.startsAt) },
      );
    if (!last) {
      // A class runs one curriculum (L2): sessions of another unit of the program lock it.
      const other = await this.otherUnitOfClass(db, classId, unit.id, lock);
      this.assert(
        !other,
        'CLASS_CURRICULUM_LOCKED',
        'The class already has sessions of another curriculum',
        HttpStatus.CONFLICT,
        { currentUnitId: other?.lesson.unit?.id, currentUnitTitle: other?.lesson.unit?.title },
      );
    }
    return {
      closures,
      anchorLessonId: last?.lesson.id ?? null,
      anchorSequence: last?.lesson.sequence ?? null,
    };
  }

  /**
   * The unit of a non-cancelled session of the class that belongs to a unit other than
   * `unitId`. `lock`: read with `FOR UPDATE` (generate), like `lockedAnchor`.
   */
  private async otherUnitOfClass(
    db: Prisma.TransactionClient,
    classId: string,
    unitId: string,
    lock: boolean,
  ): Promise<{ lesson: { unit: { id: string; title: string } | null } } | null> {
    const unitSelect = { lesson: { select: { unit: { select: { id: true, title: true } } } } };
    if (!lock) {
      return db.classSession.findFirst({
        where: { classId, status: { not: 'CANCELLED' }, lesson: { unitId: { not: unitId } } },
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
        select: unitSelect,
      });
    }
    const rows = await db.$queryRaw<Array<{ lessonId: string }>>`
      SELECT lessonId FROM class_sessions
      WHERE classId = ${classId} AND status <> 'CANCELLED'
        AND lessonId IN (SELECT id FROM lessons WHERE unitId <> ${unitId})
      ORDER BY startsAt DESC, id DESC LIMIT 1 FOR UPDATE`;
    if (!rows[0]) return null;
    const lesson = await db.lesson.findUnique({
      where: { id: rows[0].lessonId },
      select: { unit: { select: { id: true, title: true } } },
    });
    return { lesson: { unit: lesson?.unit ?? null } };
  }

  private anchor(
    db: Prisma.TransactionClient,
    classId: string,
    unit: UnitWithLessons,
  ): Promise<{ startsAt: Date; lesson: { id: string; sequence: number } } | null> {
    return db.classSession.findFirst({
      where: {
        classId,
        status: { not: 'CANCELLED' },
        lesson: { unitId: unit.id, kind: 'LESSON' },
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      select: { startsAt: true, lesson: { select: { id: true, sequence: true } } },
    });
  }

  private async lockedAnchor(
    db: Prisma.TransactionClient,
    classId: string,
    unit: UnitWithLessons,
  ): Promise<{ startsAt: Date; lesson: { id: string; sequence: number } } | null> {
    const last = await this.sessionRows.lastUnitSession(db, classId, unit.id);
    if (!last) return null;
    const lesson = unit.lessons.find((row) => row.id === last.lessonId);
    this.assert(lesson, 'LESSON_NOT_FOUND', 'Lesson of the last session is not in this unit');
    return { startsAt: last.startsAt, lesson: { id: lesson.id, sequence: lesson.sequence } };
  }

  private planWithOutlook(
    unit: UnitWithLessons,
    classroom: ClassWithSchedule,
    input: ScheduleRangeDto,
    context: PlanContext,
  ): { slots: PlannedSlot[]; startLesson: Lesson | null; endDate: string; lessonCount: number } {
    // A class starts on the approved version. A class already teaching a version that a newer
    // one replaced keeps it to the last lesson (Đợt F).
    this.assert(
      unit.status === 'APPROVED' ||
        (context.anchorSequence !== null &&
          unit.status === 'ARCHIVED' &&
          unit.archiveReason === 'SUPERSEDED'),
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
      classroom.programId === unit.programId,
      'CURRICULUM_MISMATCH',
      'Class and curriculum subject/grade do not match',
    );
    this.assert(
      classroom.teacher?.role === 'TEACHER' && classroom.teacher.status === 'ACTIVE',
      'INVALID_TEACHER',
      'Assign an active teacher to the class',
    );
    assertProgramFrequency(classroom.program, classroom.weeklySchedules.length, classroom.id);
    const planned = planLessonSlots(
      unit.lessons.filter((row) => row.kind === 'LESSON'),
      classroom.weeklySchedules,
      input.fromDate,
      context.closures,
      context.anchorSequence,
    );
    this.assert(
      planned.remaining.length,
      'CURRICULUM_COMPLETED',
      'The class has already been scheduled for every lesson of this curriculum',
      HttpStatus.CONFLICT,
    );
    this.assert(
      !planned.tooLong,
      'SCHEDULE_TOO_LONG',
      'The curriculum does not fit within 24 months from the start date',
      HttpStatus.BAD_REQUEST,
    );
    const slots = planned.slots.map((item) => {
      const lesson: Lesson = item.lesson;
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
        monthKey: item.date.slice(0, 7),
      };
    });
    return {
      slots,
      startLesson: planned.remaining[0] ?? null,
      endDate: slots[slots.length - 1].date,
      lessonCount: slots.length,
    };
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

  private scheduleSnapshot(
    unit: UnitWithLessons,
    classroom: ClassWithSchedule,
    context: PlanContext,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          closures: context.closures,
          anchorLessonId: context.anchorLessonId,
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
            sessionsPerWeek: classroom.program.sessionsPerWeek,
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

  /**
   * The version a schedule uses when the client does not name one (Đợt F): the version of the
   * class's latest session, else the approved version of its program.
   */
  private async scheduleUnitId(db: Prisma.TransactionClient, classId: string): Promise<string> {
    const last = await db.classSession.findFirst({
      where: { classId, status: { not: 'CANCELLED' } },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      select: { lesson: { select: { unitId: true } } },
    });
    if (last?.lesson.unitId) return last.lesson.unitId;
    const classroom = await db.class.findUnique({
      where: { id: classId },
      select: { programId: true },
    });
    this.assert(classroom, 'CLASS_NOT_FOUND', 'Class not found', HttpStatus.NOT_FOUND);
    const current = await db.curriculumUnit.findFirst({
      where: { programId: classroom.programId, status: 'APPROVED' },
      orderBy: [{ fromDate: 'desc' }, { version: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    this.assert(current, 'UNIT_NOT_APPROVED', 'The program has no approved curriculum');
    return current.id;
  }

  private async loadUnit(id: string): Promise<UnitWithLessons> {
    const unit = await this.db.curriculumUnit.findUnique({ where: { id }, include: unitInclude });
    this.assert(unit, 'UNIT_NOT_FOUND', 'Curriculum unit not found', HttpStatus.NOT_FOUND);
    return unit;
  }

  private async unitProgramId(id: string): Promise<string> {
    const unit = await this.db.curriculumUnit.findUnique({
      where: { id },
      select: { programId: true },
    });
    this.assert(unit, 'UNIT_NOT_FOUND', 'Curriculum unit not found', HttpStatus.NOT_FOUND);
    return unit.programId;
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
    // Every curriculum designer reads every curriculum (Q6).
    this.requireRole(user, 'MANAGER', 'CURRICULUM_DESIGNER', 'TEACHER');
    if (user.role === 'TEACHER') {
      if (unit.status === 'PENDING_REVIEW' && unit.reviewerTeacherId === user.id) return;
      this.assert(
        unit.status === 'APPROVED' || unit.status === 'ARCHIVED',
        'FORBIDDEN',
        'Unit is not approved',
        HttpStatus.FORBIDDEN,
      );
      const assigned = await this.db.class.findMany({
        where: { ...assignedTeacherWhere(user.id, new Date()), programId: unit.programId },
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

  private async assertResponsibleReviewer(
    tx: Prisma.TransactionClient,
    teacherId: string,
    programId: string,
  ): Promise<void> {
    // Same rule as the reviewer list: PROGRAM, then SUBJECT, then ANY when both are empty.
    this.assert(
      await reviewerReason(tx, teacherId, programId, new Date()),
      'INVALID_CURRICULUM_REVIEWER',
      'Choose a teacher from the reviewer list',
      HttpStatus.BAD_REQUEST,
    );
  }

  /** Versions count per program (Đợt F): a curriculum no longer has periods to number within. */
  private async nextVersion(tx: Prisma.TransactionClient, programId: string): Promise<number> {
    const latest = await tx.curriculumUnit.aggregate({
      where: { programId },
      _max: { version: true },
    });
    return (latest._max.version ?? 0) + 1;
  }

  private assertEditable(user: AuthenticatedUser, unit: UnitWithLessons): void {
    // Any curriculum designer edits a draft (Q6); revision checks stop concurrent overwrites.
    this.requireRole(user, 'CURRICULUM_DESIGNER');
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
      roleAllowed(user.role, roles),
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
    details?: unknown,
  ): asserts condition {
    if (!condition) throw new AppError(code, message, status, details);
  }

  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(work, {
          isolationLevel: 'RepeatableRead',
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

function lessonRef(lesson: Pick<Lesson, 'id' | 'title' | 'sequence'>): {
  id: string;
  title: string;
  sequence: number;
} {
  return { id: lesson.id, title: lesson.title, sequence: lesson.sequence };
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
