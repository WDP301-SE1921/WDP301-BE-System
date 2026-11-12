import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app.error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { DatabaseService } from '../../database/orm/database.service';
import { requireAdmin } from './admin-rules';
import { RECORD_KINDS, type RecordKind } from './dto/admin.dto';

type Db = DatabaseService | Prisma.TransactionClient;

/** Đăng ký chưa thu tiền: ở BE trạng thái DRAFT là hóa đơn đã gửi, đang chờ thanh toán. */
const UNPAID = 'DRAFT' as const;
/** Ghi danh còn hiệu lực (đang học hoặc chờ liên kết). */
const LIVE_ENROLLMENT = { in: ['ACTIVE', 'PENDING_LINK'] as Array<'ACTIVE' | 'PENDING_LINK'> };

const LABELS: Record<RecordKind, string> = {
  account: 'tài khoản',
  parent: 'phụ huynh',
  student: 'học sinh',
  subject: 'môn học',
  program: 'khóa học',
  class: 'lớp',
  room: 'phòng',
};

function countOf(
  rows: Array<{ _count: number } & Record<string, unknown>>,
  key: string,
): Map<string, number> {
  return new Map(rows.map((row) => [String(row[key]), row._count]));
}

const say = (count: number | undefined, text: string): string[] =>
  count ? [text.replace('{n}', String(count))] : [];

/**
 * Xóa mềm cho web Admin tổng. Xóa chỉ đặt deletedAt (+ người xóa, lý do); trạng thái gốc giữ nguyên
 * để khôi phục về đúng như cũ. Xóa từ trong ra ngoài: còn ràng buộc đang hoạt động thì 409 RECORD_IN_USE.
 */
@Injectable()
export class AdminRecordsService {
  constructor(private readonly db: DatabaseService) {}

  /** Việc phải làm trước khi xóa, theo id. Rỗng = xóa được. */
  async deleteBlockers(
    kind: RecordKind,
    ids: string[],
    actorId: string,
    db: Db = this.db,
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>(ids.map((id) => [id, []]));
    if (!ids.length) return result;
    const add = (id: string, reasons: string[]): void => {
      result.get(id)?.push(...reasons);
    };

    switch (kind) {
      case 'account':
      case 'parent': {
        const users = await db.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, email: true, role: true, status: true, deletedAt: true },
        });
        const activeAdmins = await db.user.count({
          where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
        });
        const teacherIds = users.filter((u) => u.role === 'TEACHER').map((u) => u.id);
        const parentUsers = users.filter((u) => u.role === 'PARENT');
        const [teaching, pending, children, unpaid] = await Promise.all([
          teacherIds.length
            ? db.class.groupBy({
                by: ['teacherId'],
                where: { teacherId: { in: teacherIds }, deletedAt: null },
                _count: true,
              })
            : [],
          teacherIds.length
            ? db.class.groupBy({
                by: ['pendingTeacherId'],
                where: { pendingTeacherId: { in: teacherIds }, deletedAt: null },
                _count: true,
              })
            : [],
          parentUsers.length
            ? db.studentProfile.findMany({
                where: {
                  deletedAt: null,
                  parentProfile: { userId: { in: parentUsers.map((u) => u.id) } },
                },
                select: { parentProfile: { select: { userId: true } } },
              })
            : [],
          parentUsers.length
            ? db.registrationOrder.groupBy({
                by: ['parentEmail'],
                where: { status: UNPAID, parentEmail: { in: parentUsers.map((u) => u.email) } },
                _count: true,
              })
            : [],
        ]);
        const teachingBy = countOf(teaching, 'teacherId');
        const pendingBy = countOf(pending, 'pendingTeacherId');
        const unpaidBy = countOf(unpaid, 'parentEmail');
        for (const user of users) {
          if (user.deletedAt) add(user.id, ['Bản ghi đã bị xóa']);
          if (user.id === actorId) add(user.id, ['Không thể xóa tài khoản bạn đang dùng']);
          if (
            user.role === 'ADMIN' &&
            user.status === 'ACTIVE' &&
            !user.deletedAt &&
            activeAdmins <= 1
          )
            add(user.id, ['Phải còn ít nhất một Admin tổng đang hoạt động']);
          add(user.id, say(teachingBy.get(user.id), 'Đang dạy {n} lớp — đổi giáo viên trước'));
          add(user.id, say(pendingBy.get(user.id), 'Sắp nhận {n} lớp — đổi giáo viên trước'));
          if (user.role === 'PARENT') {
            const kids = children.filter((c) => c.parentProfile.userId === user.id).length;
            add(user.id, say(kids, 'Còn {n} hồ sơ con — xóa hồ sơ con trước'));
            add(
              user.id,
              say(unpaidBy.get(user.email), 'Còn {n} đăng ký chưa thanh toán — hủy trước'),
            );
          }
        }
        return result;
      }
      case 'student': {
        const [rows, enrolled, unpaid] = await Promise.all([
          db.studentProfile.findMany({
            where: { id: { in: ids } },
            select: { id: true, deletedAt: true },
          }),
          db.enrollment.groupBy({
            by: ['studentProfileId'],
            where: { studentProfileId: { in: ids }, status: LIVE_ENROLLMENT },
            _count: true,
          }),
          db.registrationOrder.groupBy({
            by: ['targetStudentId'],
            where: { targetStudentId: { in: ids }, status: UNPAID },
            _count: true,
          }),
        ]);
        const enrolledBy = countOf(enrolled, 'studentProfileId');
        const unpaidBy = countOf(unpaid, 'targetStudentId');
        for (const row of rows) {
          if (row.deletedAt) add(row.id, ['Bản ghi đã bị xóa']);
          add(
            row.id,
            say(enrolledBy.get(row.id), 'Đang học {n} lớp — chuyển lớp hoặc cho ngừng học trước'),
          );
          add(row.id, say(unpaidBy.get(row.id), 'Còn {n} đăng ký chưa thanh toán — hủy trước'));
        }
        return result;
      }
      case 'class': {
        const [rows, enrolled, unpaid] = await Promise.all([
          db.class.findMany({ where: { id: { in: ids } }, select: { id: true, deletedAt: true } }),
          db.enrollment.groupBy({
            by: ['classId'],
            where: { classId: { in: ids }, status: LIVE_ENROLLMENT },
            _count: true,
          }),
          db.registrationOrder.groupBy({
            by: ['classId'],
            where: { classId: { in: ids }, status: UNPAID },
            _count: true,
          }),
        ]);
        const enrolledBy = countOf(enrolled, 'classId');
        const unpaidBy = countOf(unpaid, 'classId');
        for (const row of rows) {
          if (row.deletedAt) add(row.id, ['Bản ghi đã bị xóa']);
          add(
            row.id,
            say(
              enrolledBy.get(row.id),
              'Còn {n} học sinh đang học — chuyển lớp hoặc cho ngừng học trước',
            ),
          );
          add(row.id, say(unpaidBy.get(row.id), 'Còn {n} đăng ký chưa thanh toán — hủy trước'));
        }
        return result;
      }
      case 'program': {
        const [rows, classes, units] = await Promise.all([
          db.program.findMany({
            where: { id: { in: ids } },
            select: { id: true, deletedAt: true },
          }),
          db.class.groupBy({
            by: ['programId'],
            where: { programId: { in: ids }, deletedAt: null },
            _count: true,
          }),
          db.curriculumUnit.groupBy({
            by: ['programId'],
            where: { programId: { in: ids }, status: { not: 'ARCHIVED' } },
            _count: true,
          }),
        ]);
        const classBy = countOf(classes, 'programId');
        const unitBy = countOf(units, 'programId');
        for (const row of rows) {
          if (row.deletedAt) add(row.id, ['Bản ghi đã bị xóa']);
          add(row.id, say(classBy.get(row.id), 'Còn {n} lớp của khóa — xóa lớp trước'));
          add(row.id, say(unitBy.get(row.id), 'Còn {n} giáo trình chưa lưu trữ — lưu trữ trước'));
        }
        return result;
      }
      case 'subject': {
        const [rows, programs] = await Promise.all([
          db.subject.findMany({
            where: { id: { in: ids } },
            select: { id: true, deletedAt: true },
          }),
          db.program.groupBy({
            by: ['subjectId'],
            where: { subjectId: { in: ids }, deletedAt: null },
            _count: true,
          }),
        ]);
        const programBy = countOf(programs, 'subjectId');
        for (const row of rows) {
          if (row.deletedAt) add(row.id, ['Bản ghi đã bị xóa']);
          add(row.id, say(programBy.get(row.id), 'Còn {n} khóa học của môn — xóa khóa trước'));
        }
        return result;
      }
      case 'room': {
        const [rows, classes] = await Promise.all([
          db.room.findMany({ where: { id: { in: ids } }, select: { id: true, deletedAt: true } }),
          db.class.groupBy({
            by: ['roomId'],
            where: { roomId: { in: ids }, deletedAt: null },
            _count: true,
          }),
        ]);
        const classBy = countOf(classes, 'roomId');
        for (const row of rows) {
          if (row.deletedAt) add(row.id, ['Bản ghi đã bị xóa']);
          add(
            row.id,
            say(classBy.get(row.id), 'Còn {n} lớp dùng phòng — đổi phòng hoặc xóa lớp trước'),
          );
        }
        return result;
      }
    }
  }

  /** Khôi phục từ ngoài vào trong: bản ghi cha đã xóa thì khôi phục cha trước. */
  async restoreBlockers(
    kind: RecordKind,
    ids: string[],
    db: Db = this.db,
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>(ids.map((id) => [id, []]));
    if (!ids.length) return result;
    if (kind === 'account' || kind === 'parent') {
      // Tài khoản tự xóa đã mất email, mật khẩu và thông tin cá nhân: khôi phục chỉ ra tài khoản rỗng
      const rows = await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, deletedById: true },
      });
      for (const row of rows)
        if (row.deletedById === row.id)
          result
            .get(row.id)
            ?.push('Phụ huynh đã tự xóa tài khoản trên ứng dụng — không khôi phục được');
    }
    if (kind === 'student') {
      const rows = await db.studentProfile.findMany({
        where: { id: { in: ids } },
        select: { id: true, parentProfile: { select: { user: { select: { deletedAt: true } } } } },
      });
      for (const row of rows)
        if (row.parentProfile.user.deletedAt)
          result.get(row.id)?.push('Phụ huynh đã bị xóa — khôi phục phụ huynh trước');
    }
    if (kind === 'program') {
      const rows = await db.program.findMany({
        where: { id: { in: ids } },
        select: { id: true, subjectRecord: { select: { deletedAt: true } } },
      });
      for (const row of rows)
        if (row.subjectRecord?.deletedAt)
          result.get(row.id)?.push('Môn học đã bị xóa — khôi phục môn trước');
    }
    if (kind === 'class') {
      const rows = await db.class.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          program: { select: { deletedAt: true } },
          room: { select: { deletedAt: true } },
        },
      });
      for (const row of rows) {
        if (row.program.deletedAt)
          result.get(row.id)?.push('Khóa học đã bị xóa — khôi phục khóa trước');
        if (row.room?.deletedAt)
          result.get(row.id)?.push('Phòng đã bị xóa — khôi phục phòng hoặc đổi phòng trước');
      }
    }
    return result;
  }

  /** Gắn deleteBlockers / restoreBlockers vào từng dòng danh sách. */
  async withLifecycle<T extends { id: string; deletedAt: Date | null }>(
    kind: RecordKind,
    rows: T[],
    actorId: string,
  ): Promise<Array<T & { deleteBlockers: string[]; restoreBlockers: string[] }>> {
    const [deleteMap, restoreMap] = await Promise.all([
      this.deleteBlockers(
        kind,
        rows.filter((r) => !r.deletedAt).map((r) => r.id),
        actorId,
      ),
      this.restoreBlockers(
        kind,
        rows.filter((r) => r.deletedAt).map((r) => r.id),
      ),
    ]);
    return rows.map((row) => ({
      ...row,
      deleteBlockers: row.deletedAt ? ['Bản ghi đã bị xóa'] : (deleteMap.get(row.id) ?? []),
      restoreBlockers: row.deletedAt ? (restoreMap.get(row.id) ?? []) : [],
    }));
  }

  async remove(
    user: AuthenticatedUser,
    kind: RecordKind,
    id: string,
    reason: string,
  ): Promise<unknown> {
    requireAdmin(user);
    return this.db.$transaction(async (tx) => {
      const row = await this.lockAndRead(tx, kind, id);
      if (row.deletedAt)
        throw new AppError('RECORD_DELETED', 'Record is already deleted', HttpStatus.CONFLICT);
      const blockers = (await this.deleteBlockers(kind, [id], user.id, tx)).get(id) ?? [];
      if (blockers.length)
        throw new AppError('RECORD_IN_USE', blockers.join('; '), HttpStatus.CONFLICT);
      const data = { deletedAt: new Date(), deletedById: user.id, deleteReason: reason };
      await this.write(tx, kind, id, data);
      let revokedSessions = 0;
      if (kind === 'account' || kind === 'parent') {
        const revoked = await tx.authSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        revokedSessions = revoked.count;
      }
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'ADMIN_RECORD_DELETE',
          entityType: RECORD_ENTITY[kind],
          entityId: id,
          beforeData: { name: row.name, deletedAt: null },
          afterData: { label: LABELS[kind], reason, revokedSessions },
        },
      });
      return { id, kind, deletedAt: data.deletedAt };
    });
  }

  async restore(
    user: AuthenticatedUser,
    kind: RecordKind,
    id: string,
    reason: string,
  ): Promise<unknown> {
    requireAdmin(user);
    return this.db.$transaction(async (tx) => {
      const row = await this.lockAndRead(tx, kind, id);
      if (!row.deletedAt)
        throw new AppError('RECORD_NOT_DELETED', 'Record is not deleted', HttpStatus.CONFLICT);
      const blockers = (await this.restoreBlockers(kind, [id], tx)).get(id) ?? [];
      if (blockers.length)
        throw new AppError('RESTORE_BLOCKED', blockers.join('; '), HttpStatus.CONFLICT);
      await this.write(tx, kind, id, { deletedAt: null, deletedById: null, deleteReason: null });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'ADMIN_RECORD_RESTORE',
          entityType: RECORD_ENTITY[kind],
          entityId: id,
          beforeData: { name: row.name, deletedAt: row.deletedAt.toISOString() },
          afterData: { label: LABELS[kind], reason },
        },
      });
      return { id, kind, deletedAt: null };
    });
  }

  private async lockAndRead(
    tx: Prisma.TransactionClient,
    kind: RecordKind,
    id: string,
  ): Promise<{ name: string | null; deletedAt: Date | null }> {
    const notFound = (): AppError =>
      new AppError('RECORD_NOT_FOUND', 'Record not found', HttpStatus.NOT_FOUND);
    switch (kind) {
      case 'account':
      case 'parent': {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
        const row = await tx.user.findUnique({
          where: { id },
          select: { displayName: true, email: true, role: true, deletedAt: true },
        });
        if (!row || (kind === 'parent' && row.role !== 'PARENT')) throw notFound();
        return { name: row.displayName ?? row.email, deletedAt: row.deletedAt };
      }
      case 'student': {
        await tx.$queryRaw`SELECT id FROM student_profiles WHERE id = ${id} FOR UPDATE`;
        const row = await tx.studentProfile.findUnique({
          where: { id },
          select: { fullName: true, deletedAt: true },
        });
        if (!row) throw notFound();
        return { name: row.fullName, deletedAt: row.deletedAt };
      }
      case 'subject': {
        await tx.$queryRaw`SELECT id FROM subjects WHERE id = ${id} FOR UPDATE`;
        const row = await tx.subject.findUnique({
          where: { id },
          select: { name: true, deletedAt: true },
        });
        if (!row) throw notFound();
        return row;
      }
      case 'program': {
        await tx.$queryRaw`SELECT id FROM programs WHERE id = ${id} FOR UPDATE`;
        const row = await tx.program.findUnique({
          where: { id },
          select: { name: true, deletedAt: true },
        });
        if (!row) throw notFound();
        return row;
      }
      case 'class': {
        await tx.$queryRaw`SELECT id FROM classes WHERE id = ${id} FOR UPDATE`;
        const row = await tx.class.findUnique({
          where: { id },
          select: { name: true, deletedAt: true },
        });
        if (!row) throw notFound();
        return row;
      }
      case 'room': {
        await tx.$queryRaw`SELECT id FROM rooms WHERE id = ${id} FOR UPDATE`;
        const row = await tx.room.findUnique({
          where: { id },
          select: { name: true, deletedAt: true },
        });
        if (!row) throw notFound();
        return row;
      }
    }
  }

  private async write(
    tx: Prisma.TransactionClient,
    kind: RecordKind,
    id: string,
    data: { deletedAt: Date | null; deletedById: string | null; deleteReason: string | null },
  ): Promise<void> {
    if (kind === 'account' || kind === 'parent') await tx.user.update({ where: { id }, data });
    else if (kind === 'student') await tx.studentProfile.update({ where: { id }, data });
    else if (kind === 'subject') await tx.subject.update({ where: { id }, data });
    else if (kind === 'program') await tx.program.update({ where: { id }, data });
    else if (kind === 'class') await tx.class.update({ where: { id }, data });
    else await tx.room.update({ where: { id }, data });
  }
}

const RECORD_ENTITY: Record<RecordKind, string> = {
  account: 'User',
  parent: 'User',
  student: 'StudentProfile',
  subject: 'Subject',
  program: 'Program',
  class: 'Class',
  room: 'Room',
};

export { RECORD_KINDS };
