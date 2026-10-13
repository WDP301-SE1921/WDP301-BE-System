import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { Workbook, Worksheet } from 'exceljs';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AcademicAccessService, assertRule, inTerm, roles } from './academic-access.service';
import { AcademicRepository } from './academic.repository';
import { AnalyticsBucket, AnalyticsQueryDto, BulkReportExportDto } from './academic.dto';

const DAY_MS = 86400000;
const MAX_ROWS = 50000;

interface AnalyticsRange {
  from: Date;
  to: Date;
  bucket: AnalyticsBucket;
}

interface TrendPoint {
  period: string;
  completedSessions: number;
  attendanceRequired: number;
  attendanceSatisfied: number;
  attendancePercent: number | null;
  publishedGrades: number;
  averageScore: number | null;
  confirmedRevenue: number;
}

interface ClassMetric {
  classId: string;
  className: string;
  capacity: number;
  reservedSeats: number;
  utilizationPercent: number;
  completedSessions: number;
  attendanceRequired: number;
  attendanceSatisfied: number;
  attendancePercent: number | null;
  publishedGrades: number;
  averageScore: number | null;
  assignments: number;
  unpublishedSubmissions: number;
}

type Dashboard = Record<string, unknown> & {
  role: UserRole;
  generatedAt: string;
  range: { from: string; to: string; bucket: AnalyticsBucket };
};

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly repo: AcademicRepository,
    private readonly access: AcademicAccessService,
  ) {}

  async dashboard(user: AuthenticatedUser, input: AnalyticsQueryDto): Promise<Dashboard> {
    roles(user, 'MANAGER', 'TEACHER', 'CURRICULUM_DESIGNER');
    const range = analyticsRange(input);
    if (user.role === 'CURRICULUM_DESIGNER') {
      assertRule(!input.classId, 'INVALID_FILTER', 'Class filter is not available for designers');
      return this.designerDashboard(user, range);
    }
    return this.operationsDashboard(user, input.classId, range);
  }

  async exportDashboard(
    user: AuthenticatedUser,
    input: AnalyticsQueryDto,
  ): Promise<{ buffer: Buffer; type: string; name: string }> {
    const dashboard = await this.dashboard(user, input);
    const workbook = new Workbook();
    const overview = workbook.addWorksheet('Overview');
    overview.columns = [
      { header: 'Metric', key: 'metric', width: 34 },
      { header: 'Value', key: 'value', width: 24 },
    ];
    overview.addRows([
      { metric: 'Role', value: dashboard.role },
      { metric: 'From', value: dashboard.range.from },
      { metric: 'To', value: dashboard.range.to },
      { metric: 'Bucket', value: dashboard.range.bucket },
      { metric: 'Generated at', value: dashboard.generatedAt },
      ...Object.entries((dashboard.summary ?? {}) as Record<string, unknown>).map(
        ([metric, value]) => ({ metric, value: scalar(value) }),
      ),
    ]);
    styleHeader(overview);

    if (dashboard.role === 'CURRICULUM_DESIGNER') {
      addObjectSheet(workbook, 'Programs', dashboard.programs as Record<string, unknown>[]);
      addObjectSheet(workbook, 'Trend', dashboard.trend as Record<string, unknown>[]);
    } else {
      addObjectSheet(workbook, 'Classes', dashboard.classes as Record<string, unknown>[]);
      addObjectSheet(workbook, 'Trend', dashboard.trend as Record<string, unknown>[]);
    }
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      name: `analytics-${dashboard.role.toLowerCase()}-${datePart(new Date())}.xlsx`,
    };
  }

  async bulkReports(
    user: AuthenticatedUser,
    input: BulkReportExportDto,
  ): Promise<{ buffer: Buffer; type: string; name: string }> {
    roles(user, 'TEACHER');
    const reports = await this.repo.db.learningReport.findMany({
      where: { id: { in: input.reportIds }, teacherId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    assertRule(
      reports.length === input.reportIds.length,
      'REPORTS_NOT_FOUND',
      'Every report must exist and belong to the current teacher',
      HttpStatus.NOT_FOUND,
    );
    const workbook = new Workbook();
    const index = workbook.addWorksheet('Index');
    index.columns = [
      { header: 'Report ID', key: 'id', width: 28 },
      { header: 'Class', key: 'className', width: 28 },
      { header: 'From', key: 'from', width: 24 },
      { header: 'To', key: 'to', width: 24 },
      { header: 'Created at', key: 'createdAt', width: 24 },
    ];
    const usedNames = new Set<string>(['Index']);
    for (const report of reports) {
      const snapshot = report.snapshot as unknown as {
        className?: unknown;
        from?: unknown;
        to?: unknown;
        rows?: unknown;
      };
      assertRule(
        typeof snapshot.className === 'string' &&
          typeof snapshot.from === 'string' &&
          typeof snapshot.to === 'string' &&
          Array.isArray(snapshot.rows),
        'INVALID_REPORT_SNAPSHOT',
        'A selected report has an invalid snapshot',
      );
      index.addRow({
        id: report.id,
        className: snapshot.className,
        from: snapshot.from,
        to: snapshot.to,
        createdAt: report.createdAt.toISOString(),
      });
      const sheet = workbook.addWorksheet(uniqueSheetName(snapshot.className, usedNames));
      sheet.columns = [
        { header: 'Student', key: 'name', width: 32 },
        { header: 'Required sessions', key: 'required', width: 20 },
        { header: 'Attended / made up', key: 'attended', width: 22 },
        { header: 'Attendance %', key: 'attendancePercent', width: 18 },
        { header: 'Published grades', key: 'publishedGrades', width: 20 },
        { header: 'Average score %', key: 'averageScore', width: 20 },
      ];
      sheet.addRows(snapshot.rows as Record<string, unknown>[]);
      styleHeader(sheet);
    }
    styleHeader(index);
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      name: `learning-reports-${datePart(new Date())}.xlsx`,
    };
  }

  private async operationsDashboard(
    user: AuthenticatedUser,
    classId: string | undefined,
    range: AnalyticsRange,
  ): Promise<Dashboard> {
    const classWhere: Prisma.ClassWhereInput = {
      ...(classId ? { id: classId } : {}),
      ...(user.role === 'TEACHER' ? { teacherId: user.id } : {}),
    };
    if (classId) await this.access.classroom(user, classId);
    const classes = await this.repo.db.class.findMany({
      where: classWhere,
      select: { id: true, name: true, capacity: true },
      orderBy: { name: 'asc' },
    });
    assertRule(
      !classId || classes.length === 1,
      'CLASS_NOT_FOUND',
      'Class not found',
      HttpStatus.NOT_FOUND,
    );
    const classIds = classes.map((item) => item.id);
    const now = new Date();
    const [enrollments, sessions, grades, assignments, pendingLeaves, bookedMakeups, payments] =
      await Promise.all([
        this.repo.db.enrollment.findMany({
          where: {
            status: { in: ['ACTIVE', 'PENDING_LINK'] },
            OR: [
              { classId: { in: classIds } },
              { placements: { some: { classId: { in: classIds } } } },
            ],
          },
          select: {
            id: true,
            classId: true,
            status: true,
            startDate: true,
            endDate: true,
            studentProfileId: true,
            placements: { select: { classId: true, effectiveFrom: true, effectiveTo: true } },
          },
        }),
        this.repo.db.classSession.findMany({
          where: { classId: { in: classIds }, startsAt: { gte: range.from, lte: range.to } },
          select: {
            id: true,
            classId: true,
            startsAt: true,
            status: true,
            participants: {
              where: { kind: 'REGULAR', cancelled: false },
              select: {
                attendance: true,
                sourceBookings: { where: { status: 'COMPLETED' }, select: { id: true } },
              },
            },
          },
          take: MAX_ROWS + 1,
        }),
        this.repo.db.gradeReview.findMany({
          where: {
            status: 'PUBLISHED',
            publishedAt: { gte: range.from, lte: range.to },
            submission: { recipient: { assignment: { classId: { in: classIds } } } },
          },
          select: {
            totalScore: true,
            publishedAt: true,
            submission: {
              select: {
                recipient: {
                  select: {
                    assignment: {
                      select: {
                        classId: true,
                        questions: { select: { maxScore: true } },
                      },
                    },
                  },
                },
              },
            },
          },
          take: MAX_ROWS + 1,
        }),
        this.repo.db.assignment.findMany({
          where: { classId: { in: classIds }, createdAt: { lte: range.to } },
          select: {
            id: true,
            classId: true,
            status: true,
            recipients: {
              select: {
                submissions: { select: { grades: { select: { status: true } } } },
              },
            },
          },
          take: MAX_ROWS + 1,
        }),
        user.role === 'MANAGER'
          ? this.repo.db.leaveRequest.count({ where: { status: 'PENDING' } })
          : Promise.resolve(0),
        user.role === 'MANAGER'
          ? this.repo.db.makeupBooking.count({ where: { status: 'BOOKED' } })
          : Promise.resolve(0),
        user.role === 'MANAGER'
          ? this.repo.db.payment.findMany({
              where: { status: 'CONFIRMED', confirmedAt: { gte: range.from, lte: range.to } },
              select: { amount: true, confirmedAt: true },
              take: MAX_ROWS + 1,
            })
          : Promise.resolve([]),
      ]);
    assertRule(
      sessions.length <= MAX_ROWS &&
        grades.length <= MAX_ROWS &&
        assignments.length <= MAX_ROWS &&
        payments.length <= MAX_ROWS,
      'ANALYTICS_TOO_LARGE',
      'Reduce the analytics date range or select one class',
    );

    const metrics = new Map(
      classes.map((item) => [
        item.id,
        {
          classId: item.id,
          className: item.name,
          capacity: item.capacity,
          reservedSeats: 0,
          utilizationPercent: 0,
          completedSessions: 0,
          attendanceRequired: 0,
          attendanceSatisfied: 0,
          attendancePercent: null,
          publishedGrades: 0,
          averageScore: null,
          assignments: 0,
          unpublishedSubmissions: 0,
        } satisfies ClassMetric,
      ]),
    );
    for (const enrollment of enrollments) {
      const placement = enrollment.placements.find(
        (item) => item.effectiveFrom <= now && (!item.effectiveTo || item.effectiveTo > now),
      );
      const target = metrics.get(placement?.classId ?? enrollment.classId);
      const reservesSeat =
        enrollment.status === 'PENDING_LINK' ||
        (enrollment.status === 'ACTIVE' &&
          !!enrollment.startDate &&
          !!enrollment.endDate &&
          enrollment.startDate <= now &&
          enrollment.endDate >= now);
      if (target && reservesSeat) target.reservedSeats++;
    }
    const trend = trendPoints(range);
    for (const session of sessions) {
      const metric = metrics.get(session.classId)!;
      const point = trend.get(bucketKey(session.startsAt, range.bucket))!;
      if (session.status === 'COMPLETED') {
        metric.completedSessions++;
        point.completedSessions++;
        for (const participant of session.participants) {
          if (participant.attendance !== 'PRESENT' && participant.attendance !== 'ABSENT') continue;
          metric.attendanceRequired++;
          point.attendanceRequired++;
          if (participant.attendance === 'PRESENT' || participant.sourceBookings.length) {
            metric.attendanceSatisfied++;
            point.attendanceSatisfied++;
          }
        }
      }
    }
    for (const grade of grades) {
      if (!grade.publishedAt) continue;
      const assignment = grade.submission.recipient.assignment;
      const maxScore = assignment.questions.reduce((sum, item) => sum + item.maxScore, 0);
      if (maxScore <= 0) continue;
      addAverage(metrics.get(assignment.classId)!, (grade.totalScore / maxScore) * 100);
      addTrendAverage(
        trend.get(bucketKey(grade.publishedAt, range.bucket))!,
        (grade.totalScore / maxScore) * 100,
      );
    }
    for (const assignment of assignments) {
      const metric = metrics.get(assignment.classId)!;
      metric.assignments++;
      for (const recipient of assignment.recipients) {
        for (const submission of recipient.submissions) {
          if (!submission.grades.some((grade) => grade.status === 'PUBLISHED'))
            metric.unpublishedSubmissions++;
        }
      }
    }
    for (const payment of payments) {
      trend.get(bucketKey(payment.confirmedAt, range.bucket))!.confirmedRevenue += Number(
        payment.amount,
      );
    }
    for (const metric of metrics.values()) finalizeClassMetric(metric);
    for (const point of trend.values()) finalizeTrend(point);
    const classRows = [...metrics.values()];
    const allRequired = classRows.reduce((sum, item) => sum + item.attendanceRequired, 0);
    const allSatisfied = classRows.reduce((sum, item) => sum + item.attendanceSatisfied, 0);
    const allPublished = classRows.reduce((sum, item) => sum + item.publishedGrades, 0);
    const weightedScores = classRows.reduce(
      (sum, item) => sum + (item.averageScore ?? 0) * item.publishedGrades,
      0,
    );
    const activeStudents = new Set(
      enrollments
        .filter((item) => item.studentProfileId && inTerm(item, now))
        .map((item) => item.studentProfileId),
    ).size;
    const summary: Record<string, number | null> = {
      classes: classes.length,
      activeStudents,
      reservedSeats: classRows.reduce((sum, item) => sum + item.reservedSeats, 0),
      completedSessions: classRows.reduce((sum, item) => sum + item.completedSessions, 0),
      attendancePercent: percent(allSatisfied, allRequired),
      assignments: classRows.reduce((sum, item) => sum + item.assignments, 0),
      unpublishedSubmissions: classRows.reduce((sum, item) => sum + item.unpublishedSubmissions, 0),
      publishedGrades: allPublished,
      averageScore: allPublished ? round(weightedScores / allPublished) : null,
    };
    if (user.role === 'MANAGER') {
      summary.pendingLeaves = pendingLeaves;
      summary.bookedMakeups = bookedMakeups;
      summary.confirmedRevenue = payments.reduce((sum, item) => sum + Number(item.amount), 0);
    }
    return baseDashboard(user.role, range, {
      summary,
      classes: classRows,
      trend: [...trend.values()],
    });
  }

  private async designerDashboard(
    user: AuthenticatedUser,
    range: AnalyticsRange,
  ): Promise<Dashboard> {
    const [lessons, feedback] = await Promise.all([
      this.repo.db.lesson.findMany({
        where: { designerId: user.id },
        select: {
          id: true,
          programId: true,
          status: true,
          basedOnId: true,
          createdAt: true,
          program: { select: { name: true } },
        },
        take: MAX_ROWS + 1,
      }),
      this.repo.db.curriculumFeedback.findMany({
        where: { lesson: { designerId: user.id } },
        select: {
          status: true,
          createdAt: true,
          updatedAt: true,
          lesson: { select: { programId: true } },
        },
        take: MAX_ROWS + 1,
      }),
    ]);
    assertRule(
      lessons.length <= MAX_ROWS && feedback.length <= MAX_ROWS,
      'ANALYTICS_TOO_LARGE',
      'Designer analytics exceeds the supported size',
    );
    const programs = new Map<
      string,
      {
        programId: string;
        programName: string;
        drafts: number;
        approved: number;
        revisions: number;
        openFeedback: number;
        resolvedFeedback: number;
      }
    >();
    for (const lesson of lessons) {
      if (!programs.has(lesson.programId))
        programs.set(lesson.programId, {
          programId: lesson.programId,
          programName: lesson.program.name,
          drafts: 0,
          approved: 0,
          revisions: 0,
          openFeedback: 0,
          resolvedFeedback: 0,
        });
      const row = programs.get(lesson.programId)!;
      if (lesson.status === 'DRAFT') row.drafts++;
      else row.approved++;
      if (lesson.basedOnId) row.revisions++;
    }
    const trend = new Map(
      [...trendPoints(range).keys()].map((period) => [
        period,
        { period, lessonsCreated: 0, feedbackReceived: 0, feedbackResolved: 0 },
      ]),
    );
    for (const lesson of lessons) {
      if (lesson.createdAt >= range.from && lesson.createdAt <= range.to)
        trend.get(bucketKey(lesson.createdAt, range.bucket))!.lessonsCreated++;
    }
    for (const item of feedback) {
      const row = programs.get(item.lesson.programId);
      if (!row) continue;
      if (item.status === 'RESOLVED' || item.status === 'DECLINED') row.resolvedFeedback++;
      else row.openFeedback++;
      if (item.createdAt >= range.from && item.createdAt <= range.to)
        trend.get(bucketKey(item.createdAt, range.bucket))!.feedbackReceived++;
      if (
        (item.status === 'RESOLVED' || item.status === 'DECLINED') &&
        item.updatedAt >= range.from &&
        item.updatedAt <= range.to
      )
        trend.get(bucketKey(item.updatedAt, range.bucket))!.feedbackResolved++;
    }
    const resolved = feedback.filter(
      (item) => item.status === 'RESOLVED' || item.status === 'DECLINED',
    ).length;
    return baseDashboard(user.role, range, {
      summary: {
        programs: programs.size,
        lessons: lessons.length,
        drafts: lessons.filter((item) => item.status === 'DRAFT').length,
        approved: lessons.filter((item) => item.status === 'APPROVED').length,
        revisions: lessons.filter((item) => item.basedOnId).length,
        openFeedback: feedback.length - resolved,
        resolvedFeedback: resolved,
        resolutionPercent: percent(resolved, feedback.length),
      },
      programs: [...programs.values()],
      trend: [...trend.values()],
    });
  }
}

function analyticsRange(input: AnalyticsQueryDto): AnalyticsRange {
  const from = new Date(input.from);
  const to = new Date(input.to);
  assertRule(
    from <= to && to.getTime() - from.getTime() <= 366 * DAY_MS,
    'INVALID_ANALYTICS_RANGE',
    'Analytics range must be at most 366 days',
  );
  return { from, to, bucket: input.bucket };
}

function baseDashboard(
  role: UserRole,
  range: AnalyticsRange,
  data: Record<string, unknown>,
): Dashboard {
  return {
    role,
    generatedAt: new Date().toISOString(),
    range: { from: range.from.toISOString(), to: range.to.toISOString(), bucket: range.bucket },
    ...data,
  };
}

function trendPoints(range: AnalyticsRange): Map<string, TrendPoint> {
  const points = new Map<string, TrendPoint>();
  const cursor = bucketStart(range.from, range.bucket);
  while (cursor <= range.to) {
    const period = bucketKey(cursor, range.bucket);
    points.set(period, {
      period,
      completedSessions: 0,
      attendanceRequired: 0,
      attendanceSatisfied: 0,
      attendancePercent: null,
      publishedGrades: 0,
      averageScore: null,
      confirmedRevenue: 0,
    });
    advanceBucket(cursor, range.bucket);
  }
  return points;
}

function bucketStart(value: Date, bucket: AnalyticsBucket): Date {
  const local = new Date(value.getTime() + 7 * 3600000);
  local.setUTCHours(0, 0, 0, 0);
  if (bucket === AnalyticsBucket.WEEK) {
    const day = local.getUTCDay() || 7;
    local.setUTCDate(local.getUTCDate() - day + 1);
  } else if (bucket === AnalyticsBucket.MONTH) local.setUTCDate(1);
  return new Date(local.getTime() - 7 * 3600000);
}

function bucketKey(value: Date, bucket: AnalyticsBucket): string {
  return datePart(bucketStart(value, bucket));
}

function advanceBucket(value: Date, bucket: AnalyticsBucket): void {
  if (bucket === AnalyticsBucket.DAY) value.setUTCDate(value.getUTCDate() + 1);
  else if (bucket === AnalyticsBucket.WEEK) value.setUTCDate(value.getUTCDate() + 7);
  else value.setUTCMonth(value.getUTCMonth() + 1);
}

function addAverage(metric: ClassMetric, score: number): void {
  metric.averageScore =
    ((metric.averageScore ?? 0) * metric.publishedGrades + score) / (metric.publishedGrades + 1);
  metric.publishedGrades++;
}

function addTrendAverage(point: TrendPoint, score: number): void {
  point.averageScore =
    ((point.averageScore ?? 0) * point.publishedGrades + score) / (point.publishedGrades + 1);
  point.publishedGrades++;
}

function finalizeClassMetric(metric: ClassMetric): void {
  metric.utilizationPercent = percent(metric.reservedSeats, metric.capacity) ?? 0;
  metric.attendancePercent = percent(metric.attendanceSatisfied, metric.attendanceRequired);
  metric.averageScore = metric.averageScore === null ? null : round(metric.averageScore);
}

function finalizeTrend(point: TrendPoint): void {
  point.attendancePercent = percent(point.attendanceSatisfied, point.attendanceRequired);
  point.averageScore = point.averageScore === null ? null : round(point.averageScore);
}

function percent(value: number, total: number): number | null {
  return total ? round((value / total) * 100) : null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function datePart(value: Date): string {
  return new Date(value.getTime() + 7 * 3600000).toISOString().slice(0, 10);
}

function scalar(value: unknown): string | number | boolean | null {
  return ['string', 'number', 'boolean'].includes(typeof value) || value === null
    ? (value as string | number | boolean | null)
    : JSON.stringify(value);
}

function addObjectSheet(workbook: Workbook, name: string, rows: Record<string, unknown>[]): void {
  const sheet = workbook.addWorksheet(name);
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  sheet.columns = keys.map((key) => ({ header: key, key, width: Math.max(16, key.length + 3) }));
  sheet.addRows(rows.map((row) => Object.fromEntries(keys.map((key) => [key, scalar(row[key])]))));
  styleHeader(sheet);
}

function styleHeader(sheet: Worksheet): void {
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = sheet.columnCount
    ? { from: 'A1', to: sheet.getRow(1).getCell(sheet.columnCount).address }
    : undefined;
}

function uniqueSheetName(raw: string, used: Set<string>): string {
  const base =
    raw
      .replace(/[\\/?*:[\]]/g, ' ')
      .trim()
      .slice(0, 25) || 'Report';
  let name = base;
  let suffix = 2;
  while (used.has(name)) name = `${base.slice(0, 27)} ${suffix++}`.slice(0, 31);
  used.add(name);
  return name;
}
