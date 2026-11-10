import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app.error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { DatabaseService } from '../../database/orm/database.service';
import { requireAdmin } from './admin-rules';
import { AdminRecordsService } from './admin-records.service';
import type { CreateAdminStudentDto } from './dto/admin.dto';

const LIVE = { in: ['ACTIVE', 'PENDING_LINK'] as Array<'ACTIVE' | 'PENDING_LINK'> };
/** Giới hạn an toàn cho danh sách gộp của web Admin (một trung tâm). */
const MAX_ROWS = 2000;

const softDelete = { deletedAt: true, deletedById: true, deleteReason: true } as const;

const orderSelect = {
  id: true,
  status: true,
  parentEmail: true,
  studentFullName: true,
  quotedAmount: true,
  packageMonths: true,
  startDate: true,
  createdAt: true,
  confirmedAt: true,
  classId: true,
  targetStudentId: true,
  billSnapshot: true,
  class: { select: { name: true } },
  targetStudent: { select: { fullName: true } },
} satisfies Prisma.RegistrationOrderSelect;

const classSelect = {
  id: true,
  name: true,
  programId: true,
  teacherId: true,
  roomId: true,
  capacity: true,
  monthlyFee: true,
  isOpen: true,
  isActive: true,
  createdAt: true,
  ...softDelete,
  program: { select: { name: true, deletedAt: true } },
  teacher: { select: { displayName: true } },
  room: { select: { name: true, deletedAt: true } },
  weeklySchedules: { select: { weekday: true, startTime: true, endTime: true } },
} satisfies Prisma.ClassSelect;

type ClassRow = Prisma.ClassGetPayload<{ select: typeof classSelect }>;

/**
 * Đọc cho web Admin tổng: danh sách gồm cả bản ghi đã xóa mềm (kèm việc phải làm trước khi xóa /
 * khôi phục), trang chi tiết và dữ liệu chọn cho form. Chỉ đọc, chỉ ADMIN.
 */
@Injectable()
export class AdminReadService {
  constructor(
    private readonly db: DatabaseService,
    private readonly records: AdminRecordsService,
  ) {}

  /** Tên người xóa theo id (để hiện "Người xóa"). */
  private async withDeleter<T extends { deletedById: string | null }>(
    rows: T[],
  ): Promise<Array<T & { deletedBy: string | null }>> {
    const ids = [...new Set(rows.map((row) => row.deletedById).filter(Boolean))] as string[];
    const users = ids.length
      ? await this.db.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, displayName: true, email: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.displayName ?? u.email]));
    return rows.map((row) => ({
      ...row,
      deletedBy: row.deletedById ? (names.get(row.deletedById) ?? null) : null,
    }));
  }

  private async rosterCounts(classIds: string[]): Promise<Map<string, number>> {
    if (!classIds.length) return new Map();
    const rows = await this.db.enrollment.groupBy({
      by: ['classId'],
      where: { classId: { in: classIds }, status: LIVE },
      _count: true,
    });
    return new Map(rows.map((row) => [row.classId, row._count]));
  }

  private classView(row: ClassRow, roster: Map<string, number>): Record<string, unknown> {
    return { ...row, monthlyFee: Number(row.monthlyFee), rosterCount: roster.get(row.id) ?? 0 };
  }

  async parents(user: AuthenticatedUser): Promise<unknown> {
    requireAdmin(user);
    const rows = await this.db.user.findMany({
      where: { role: 'PARENT' },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        createdAt: true,
        ...softDelete,
        parentProfile: {
          select: {
            phone: true,
            students: {
              select: {
                id: true,
                fullName: true,
                grade: true,
                status: true,
                deletedAt: true,
                enrollments: {
                  where: { status: LIVE },
                  select: { class: { select: { name: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: MAX_ROWS,
    });
    return this.records.withLifecycle('parent', await this.withDeleter(rows), user.id);
  }

  async parent(user: AuthenticatedUser, id: string): Promise<unknown> {
    requireAdmin(user);
    const rows = (await this.parents(user)) as Array<{ id: string; email: string }>;
    const parent = rows.find((row) => row.id === id);
    if (!parent) return null;
    const [students, registrations, sessions] = await Promise.all([
      this.studentRows(user, { parentProfile: { userId: id } }),
      this.db.registrationOrder.findMany({
        where: { parentEmail: parent.email },
        select: orderSelect,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.authSession.count({
        where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);
    return { ...parent, students, registrations, sessionCount: sessions };
  }

  private async studentRows(
    user: AuthenticatedUser,
    where: Prisma.StudentProfileWhereInput = {},
  ): Promise<unknown[]> {
    const rows = await this.db.studentProfile.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        grade: true,
        dateOfBirth: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        ...softDelete,
        parentProfile: {
          select: {
            phone: true,
            user: { select: { id: true, displayName: true, email: true, deletedAt: true } },
          },
        },
        enrollments: {
          where: { status: LIVE },
          select: { id: true, class: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: MAX_ROWS,
    });
    return this.records.withLifecycle('student', await this.withDeleter(rows), user.id);
  }

  students(user: AuthenticatedUser): Promise<unknown> {
    requireAdmin(user);
    return this.studentRows(user);
  }

  async student(user: AuthenticatedUser, id: string): Promise<unknown> {
    requireAdmin(user);
    const [row] = (await this.studentRows(user, { id })) as Array<Record<string, unknown>>;
    if (!row) return null;
    const enrollments = await this.db.enrollment.findMany({
      where: { studentProfileId: id, status: LIVE },
      select: { id: true, class: { select: classSelect } },
    });
    const roster = await this.rosterCounts(enrollments.map((e) => e.class.id));
    const registrations = await this.db.registrationOrder.findMany({
      where: { targetStudentId: id },
      select: orderSelect,
      orderBy: { createdAt: 'desc' },
    });
    return {
      ...row,
      classes: enrollments.map((e) => ({
        enrollmentId: e.id,
        ...this.classView(e.class, roster),
      })),
      registrations,
    };
  }

  /** Thêm hồ sơ con cho một phụ huynh (phụ huynh chưa xóa). */
  async createStudent(user: AuthenticatedUser, input: CreateAdminStudentDto): Promise<unknown> {
    requireAdmin(user);
    return this.db.$transaction(async (tx) => {
      const profile = await tx.parentProfile.findFirst({
        where: { userId: input.parentId, user: { role: 'PARENT', deletedAt: null } },
        select: { id: true },
      });
      if (!profile)
        throw new AppError('PARENT_NOT_FOUND', 'Parent not found', HttpStatus.NOT_FOUND);
      const created = await tx.studentProfile.create({
        data: {
          parentProfileId: profile.id,
          fullName: input.fullName,
          grade: input.grade,
          dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00.000Z`) : null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'ADMIN_STUDENT_CREATE',
          entityType: 'StudentProfile',
          entityId: created.id,
          afterData: { fullName: created.fullName, grade: created.grade },
        },
      });
      return created;
    });
  }

  async catalog(user: AuthenticatedUser): Promise<unknown> {
    requireAdmin(user);
    const [subjects, programs] = await Promise.all([
      this.db.subject.findMany({
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
          ...softDelete,
          programs: { where: { deletedAt: null }, select: { id: true } },
        },
        orderBy: { name: 'asc' },
        take: MAX_ROWS,
      }),
      this.db.program.findMany({
        select: {
          id: true,
          name: true,
          subject: true,
          subjectId: true,
          grade: true,
          sessionsPerWeek: true,
          isActive: true,
          ...softDelete,
          subjectRecord: { select: { name: true } },
          classes: {
            select: { id: true, name: true, capacity: true, isActive: true, deletedAt: true },
          },
          curriculumUnits: { select: { id: true, title: true, status: true } },
        },
        orderBy: [{ grade: 'asc' }, { name: 'asc' }],
        take: MAX_ROWS,
      }),
    ]);
    const roster = await this.rosterCounts(programs.flatMap((p) => p.classes.map((c) => c.id)));
    const programRows = programs.map((program) => ({
      ...program,
      classes: program.classes.map((item) => ({ ...item, rosterCount: roster.get(item.id) ?? 0 })),
    }));
    return {
      subjects: await this.records.withLifecycle(
        'subject',
        await this.withDeleter(subjects),
        user.id,
      ),
      programs: await this.records.withLifecycle(
        'program',
        await this.withDeleter(programRows),
        user.id,
      ),
    };
  }

  async classrooms(user: AuthenticatedUser): Promise<unknown> {
    requireAdmin(user);
    const [classes, rooms, teachers, programs] = await Promise.all([
      this.db.class.findMany({
        select: classSelect,
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
      }),
      this.db.room.findMany({
        select: {
          id: true,
          name: true,
          capacity: true,
          isActive: true,
          ...softDelete,
          classes: { where: { deletedAt: null }, select: { id: true } },
        },
        orderBy: { name: 'asc' },
        take: MAX_ROWS,
      }),
      this.db.user.findMany({
        where: { role: 'TEACHER', status: 'ACTIVE', deletedAt: null },
        select: { id: true, displayName: true, email: true },
        orderBy: { displayName: 'asc' },
      }),
      this.db.program.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, name: true, grade: true, sessionsPerWeek: true },
        orderBy: [{ grade: 'asc' }, { name: 'asc' }],
      }),
    ]);
    const roster = await this.rosterCounts(classes.map((c) => c.id));
    return {
      classes: await this.records.withLifecycle(
        'class',
        await this.withDeleter(classes.map((c) => this.classView(c, roster) as ClassRow)),
        user.id,
      ),
      rooms: await this.records.withLifecycle('room', await this.withDeleter(rooms), user.id),
      teachers,
      programs,
    };
  }

  async classDetail(user: AuthenticatedUser, id: string): Promise<unknown> {
    requireAdmin(user);
    const row = await this.db.class.findUnique({ where: { id }, select: classSelect });
    if (!row) return null;
    const roster = await this.rosterCounts([id]);
    const [[withLife], students, registrations] = await Promise.all([
      this.records.withLifecycle(
        'class',
        await this.withDeleter([this.classView(row, roster) as ClassRow]),
        user.id,
      ),
      this.studentRows(user, { enrollments: { some: { classId: id, status: LIVE } } }),
      this.db.registrationOrder.findMany({
        where: { classId: id },
        select: orderSelect,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { ...withLife, students, registrations };
  }

  /** Dữ liệu chọn cho form tạo đăng ký: học sinh đang hoạt động + lớp đang tuyển sinh. */
  async registrationOptions(user: AuthenticatedUser): Promise<unknown> {
    requireAdmin(user);
    const [students, classes] = await Promise.all([
      this.db.studentProfile.findMany({
        where: { deletedAt: null, status: 'ACTIVE', parentProfile: { user: { deletedAt: null } } },
        select: {
          id: true,
          fullName: true,
          grade: true,
          parentProfile: {
            select: { user: { select: { id: true, displayName: true, email: true } } },
          },
          enrollments: { where: { status: LIVE }, select: { classId: true } },
        },
        orderBy: { fullName: 'asc' },
        take: MAX_ROWS,
      }),
      this.db.class.findMany({
        where: { deletedAt: null, isActive: true, isOpen: true, program: { deletedAt: null } },
        select: classSelect,
        orderBy: { name: 'asc' },
        take: MAX_ROWS,
      }),
    ]);
    const roster = await this.rosterCounts(classes.map((c) => c.id));
    return {
      students,
      classes: classes.map((c) => this.classView(c, roster)),
    };
  }
}
