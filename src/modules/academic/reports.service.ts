import { Injectable } from '@nestjs/common';
import { pageResult } from '../../common/pagination';
import { dateTimeRange } from '../../common/list-query';
import { ClassContentQueryDto } from './academic-list.dto';
import { Workbook } from 'exceljs';
import * as PDFDocument from 'pdfkit';
import { resolve } from 'node:path';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { assignedTeacherWhere } from '../registration-flow/class-teacher';
import { AcademicRepository } from './academic.repository';
import { attendanceContribution } from './attendance-calculation';
import { AcademicAccessService, assertRule, roles } from './academic-access.service';
import { AcademicAiService, isRecord } from '../../integrations/academic-ai.service';
import { ReportDto } from './academic.dto';

export interface ReportRow {
  studentId: string;
  name: string;
  required: number;
  attended: number;
  attendancePercent: number | null;
  publishedGrades: number;
  averageScore: number | null;
}
interface ReportSnapshot {
  from: string;
  to: string;
  /** Học sinh được chọn khi tạo; null là toàn lớp. Snapshot cũ không có trường này. */
  studentId?: string | null;
  className: string;
  generatedAt: string;
  rows: ReportRow[];
  teachingProgress: { totalSessions: number; completedSessions: number; percent: number | null };
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly repo: AcademicRepository,
    private readonly access: AcademicAccessService,
    private readonly ai: AcademicAiService,
  ) {}

  async create(user: AuthenticatedUser, input: ReportDto): Promise<unknown> {
    roles(user, 'TEACHER');
    await this.access.classroom(user, input.classId);
    const from = new Date(
      /^\d{4}-\d{2}-\d{2}$/.test(input.from) ? `${input.from}T00:00:00.000+07:00` : input.from,
    );
    const to = new Date(
      /^\d{4}-\d{2}-\d{2}$/.test(input.to) ? `${input.to}T23:59:59.999+07:00` : input.to,
    );
    assertRule(
      from <= to && to.getTime() - from.getTime() <= 366 * 86400000,
      'INVALID_REPORT_RANGE',
      'Report range must be at most 366 days',
    );
    const snapshot = await this.repo.transaction(async (tx) => {
      const classroom = await tx.class.findUniqueOrThrow({ where: { id: input.classId } });
      const totalSessions = await tx.classSession.count({
        where: {
          classId: input.classId,
          startsAt: { gte: from, lte: to },
          status: { not: 'CANCELLED' },
        },
      });
      const completedSessions = await tx.classSession.count({
        where: { classId: input.classId, startsAt: { gte: from, lte: to }, status: 'COMPLETED' },
      });
      const participants = await tx.sessionParticipant.findMany({
        where: {
          kind: 'REGULAR',
          cancelled: false,
          session: {
            classId: input.classId,
            startsAt: { gte: from, lte: to },
            status: 'COMPLETED',
          },
          enrollment: { studentProfileId: input.studentId ?? { not: null } },
        },
        include: {
          enrollment: { include: { studentProfile: true } },
          sourceBookings: { where: { status: 'COMPLETED' } },
        },
        take: 20001,
      });
      const grades = await tx.gradeReview.findMany({
        where: {
          status: 'PUBLISHED',
          submission: {
            submittedAt: { gte: from, lte: to },
            recipient: {
              assignment: { classId: input.classId },
              enrollment: { studentProfileId: input.studentId ?? { not: null } },
            },
          },
        },
        include: {
          submission: {
            include: {
              recipient: {
                include: {
                  enrollment: { include: { studentProfile: true } },
                  assignment: { include: { questions: true } },
                },
              },
            },
          },
        },
        take: 20001,
      });
      assertRule(
        participants.length <= 20000 && grades.length <= 20000,
        'REPORT_TOO_LARGE',
        'Reduce the report date range',
      );
      const rows = new Map<string, ReportRow>();
      const ensure = (id: string, name: string): ReportRow => {
        if (!rows.has(id))
          rows.set(id, {
            studentId: id,
            name,
            required: 0,
            attended: 0,
            attendancePercent: null,
            publishedGrades: 0,
            averageScore: null,
          });
        return rows.get(id)!;
      };
      for (const p of participants) {
        const student = p.enrollment.studentProfile;
        if (!student) continue;
        const row = ensure(student.id, student.fullName);
        const contribution = attendanceContribution(p.attendance, p.sourceBookings.length > 0);
        row.required += contribution.required;
        row.attended += contribution.attended;
      }
      for (const grade of grades) {
        const student = grade.submission.recipient.enrollment.studentProfile;
        if (!student) continue;
        const row = ensure(student.id, student.fullName);
        const max = grade.submission.recipient.assignment.questions.reduce(
          (s, q) => s + q.maxScore,
          0,
        );
        row.averageScore =
          ((row.averageScore ?? 0) * row.publishedGrades + (grade.totalScore / max) * 100) /
          (row.publishedGrades + 1);
        row.publishedGrades++;
      }
      for (const row of rows.values()) {
        row.attendancePercent = row.required
          ? Math.round((row.attended / row.required) * 10000) / 100
          : null;
        row.averageScore =
          row.averageScore === null ? null : Math.round(row.averageScore * 100) / 100;
      }
      return {
        from: input.from,
        to: input.to,
        studentId: input.studentId ?? null,
        className: classroom.name,
        generatedAt: new Date().toISOString(),
        teachingProgress: {
          totalSessions,
          completedSessions,
          percent: totalSessions
            ? Math.round((completedSessions / totalSessions) * 10000) / 100
            : null,
        },
        rows: [...rows.values()],
      };
    });
    let aiSummary: string | undefined;
    if (input.includeAi) {
      const result = await this.ai.json(
        'Write a concise Vietnamese learning summary from these computed statistics. Do not invent data. Return {"summary":"..."}. Scores are percentages. Null means no data.',
        {
          rows: snapshot.rows.map((row) => ({
            studentId: row.studentId,
            required: row.required,
            attended: row.attended,
            attendancePercent: row.attendancePercent,
            publishedGrades: row.publishedGrades,
            averageScore: row.averageScore,
          })),
        },
      );
      assertRule(
        isRecord(result) && typeof result.summary === 'string' && result.summary.length <= 20000,
        'INVALID_AI_REPORT',
        'AI returned an invalid summary',
      );
      aiSummary = result.summary;
    }
    await this.access.classroom(user, input.classId);
    return this.repo.db.learningReport.create({
      data: {
        teacherId: user.id,
        classId: input.classId,
        snapshot: { ...snapshot, rows: snapshot.rows.map((row) => ({ ...row })) },
        aiSummary,
      },
    });
  }

  async list(user: AuthenticatedUser, page: ClassContentQueryDto): Promise<unknown> {
    roles(user, 'TEACHER');
    const classes = await this.repo.db.class.findMany({
      where: { AND: [assignedTeacherWhere(user.id, new Date()), {
        ...(page.classId ? { id: page.classId } : {}),
        ...(page.search ? { name: { contains: page.search } } : {}),
      }] },
      select: { id: true },
    });
    const where = { classId: { in: classes.map((c) => c.id) }, createdAt: dateTimeRange(page.fromDate, page.toDate) };
    const reports = await this.repo.db.learningReport.findMany({
      where,
      select: { id: true, classId: true, createdAt: true, snapshot: true },
      take: page.limit,
      skip: (page.page - 1) * page.limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    // The list exposes scope and range only; per-student rows stay in the export.
    const items = reports.map(({ snapshot, ...report }) => {
      const data = snapshot as unknown as ReportSnapshot;
      const scoped = typeof data.studentId === 'string';
      return {
        ...report,
        from: data.from,
        to: data.to,
        scope: !('studentId' in data) ? null : scoped ? 'STUDENT' : 'CLASS',
        studentId: scoped ? data.studentId : null,
        studentName: scoped
          ? (data.rows.find((row) => row.studentId === data.studentId)?.name ?? null)
          : null,
      };
    });
    return pageResult(page, Promise.resolve(items), () => this.repo.db.learningReport.count({ where }));
  }

  async export(
    user: AuthenticatedUser,
    id: string,
    format: string,
  ): Promise<{ buffer: Buffer; type: string; name: string }> {
    roles(user, 'TEACHER');
    assertRule(format === 'xlsx' || format === 'pdf', 'INVALID_FORMAT', 'Use xlsx or pdf');
    const report = await this.repo.db.learningReport.findUniqueOrThrow({ where: { id } });
    await this.access.classroom(user, report.classId);
    const snapshot = report.snapshot as unknown as ReportSnapshot;
    if (format === 'xlsx') {
      const workbook = new Workbook();
      const sheet = workbook.addWorksheet('Learning report');
      sheet.columns = [
        { header: 'Student', key: 'name', width: 32 },
        { header: 'Required sessions', key: 'required', width: 22 },
        { header: 'Attended / made up', key: 'attended', width: 22 },
        { header: 'Attendance %', key: 'attendancePercent', width: 20 },
        { header: 'Published grades', key: 'publishedGrades', width: 22 },
        { header: 'Average score %', key: 'averageScore', width: 22 },
      ];
      sheet.addRows(snapshot.rows);
      sheet.getRow(1).font = { bold: true };
      const info = workbook.addWorksheet('Context');
      info.addRows([
        ['Class', snapshot.className],
        ['From', snapshot.from],
        ['To', snapshot.to],
        ['Snapshot', snapshot.generatedAt],
        ['Completed sessions', snapshot.teachingProgress.completedSessions],
        ['Total sessions', snapshot.teachingProgress.totalSessions],
        ['AI summary', report.aiSummary ?? 'Not requested'],
      ]);
      return {
        buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        name: `report-${id}.xlsx`,
      };
    }
    const doc = new PDFDocument({ margin: 45, size: 'A4' });
    const parts: Buffer[] = [];
    const complete = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => parts.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(parts)));
      doc.on('error', reject);
    });
    doc
      .font(resolve(process.cwd(), 'assets/fonts/NotoSans-Regular.ttf'))
      .fontSize(18)
      .text('EduGrade - Learning report');
    doc
      .fontSize(10)
      .text(
        `${snapshot.className}\n${snapshot.from} - ${snapshot.to}\nSnapshot: ${snapshot.generatedAt}`,
      )
      .moveDown();
    for (const row of snapshot.rows)
      doc
        .text(
          `${row.name}\nAttendance: ${row.attended}/${row.required} (${row.attendancePercent ?? 'N/A'}%) | Published grades: ${row.publishedGrades} | Average: ${row.averageScore ?? 'N/A'}%`,
        )
        .moveDown();
    doc
      .text(
        `Teaching progress: ${snapshot.teachingProgress.completedSessions}/${snapshot.teachingProgress.totalSessions} sessions`,
      )
      .moveDown();
    if (report.aiSummary) doc.addPage().text(report.aiSummary);
    doc.end();
    return { buffer: await complete, type: 'application/pdf', name: `report-${id}.pdf` };
  }
}
