import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { DatabaseService } from '../../database/orm/database.service';
import {
  addDays,
  dailySeries,
  dateColumn,
  type DayRange,
  expiringWithoutRenewal,
  groupTotals,
  monthKeys,
  previousRange,
  resolveDashboardRange,
  SENSITIVE_ACTIONS,
  sensitiveKind,
  startOfVietnamDay,
  topPayers,
  vietnamDay,
} from './admin-dashboard-metrics';
import { requireAdmin } from './admin-rules';
import type { AdminDashboardQueryDto } from './dto/admin.dto';

const HISTORY_MONTHS = 12;
const EXPIRING_DAYS = 30;
const LATEST_PAYMENTS = 50;
const TOP_PAYERS = 10;
const INACTIVE_DAYS = 30;
const DAY_MS = 86_400_000;

/** `[00:00 ngày đầu, 00:00 ngày sau ngày cuối)` theo giờ trung tâm. */
const span = (range: DayRange): { gte: Date; lt: Date } => ({
  gte: startOfVietnamDay(range.fromDate),
  lt: startOfVietnamDay(addDays(range.toDate, 1)),
});
const money = (value: Prisma.Decimal | number | null | undefined): number => Number(value ?? 0);

/**
 * Số liệu tổng hợp cho dashboard Admin tổng. Chỉ ADMIN gọi; chỉ đọc; không đổi API của vai trò khác.
 */
@Injectable()
export class AdminDashboardService {
  constructor(private readonly db: DatabaseService) {}

  /** Tab Kinh doanh: doanh thu, biên lai, phụ huynh, gói sắp hết hạn, học sinh, lớp. */
  async business(user: AuthenticatedUser, query: AdminDashboardQueryDto): Promise<unknown> {
    requireAdmin(user);
    const now = new Date();
    const today = vietnamDay(now);
    const range = resolveDashboardRange(query, today);
    const previous = previousRange(range.fromDate, range.toDate);
    const months = monthKeys(today, HISTORY_MONTHS);
    const todayColumn = dateColumn(today);

    const [
      payments,
      previousTotals,
      history,
      pending,
      cancelled,
      activeStudents,
      createdStudents,
      endedEnrollments,
      classes,
      current,
      expiringSoon,
    ] = await Promise.all([
      this.db.payment.findMany({
        where: { confirmedAt: span(range) },
        select: {
          id: true,
          amount: true,
          confirmedAt: true,
          receiptNumber: true,
          confirmedByManager: { select: { id: true, displayName: true, email: true } },
          registrationOrder: {
            select: {
              parentEmail: true,
              studentFullName: true,
              studentGrade: true,
              packageMonths: true,
              type: true,
              class: { select: { id: true, name: true, program: { select: { subject: true } } } },
            },
          },
        },
        orderBy: [{ confirmedAt: 'desc' }, { id: 'asc' }],
      }),
      this.db.payment.aggregate({
        where: { confirmedAt: span(previous) },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.db.payment.findMany({
        where: { confirmedAt: { gte: startOfVietnamDay(`${months[0]}-01`) } },
        select: { amount: true, confirmedAt: true },
      }),
      this.db.registrationOrder.aggregate({
        where: { status: 'DRAFT' },
        _sum: { quotedAmount: true },
        _count: { _all: true },
        _min: { createdAt: true },
      }),
      this.db.registrationOrder.aggregate({
        where: { status: 'CANCELLED', updatedAt: span(range) },
        _sum: { quotedAmount: true },
        _count: { _all: true },
      }),
      this.db.studentProfile.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.db.studentProfile.count({ where: { createdAt: span(range), deletedAt: null } }),
      this.db.enrollment.count({ where: { status: 'ENDED', endedAt: span(range) } }),
      this.db.class.findMany({
        where: { isActive: true, deletedAt: null },
        select: {
          id: true,
          name: true,
          capacity: true,
          isOpen: true,
          teacher: { select: { displayName: true, email: true } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      // Ghi danh còn hiệu lực hôm nay, kèm lớp đang học (chuyển lớp đi qua placement).
      this.db.enrollment.findMany({
        where: { status: 'ACTIVE', startDate: { lte: todayColumn }, endDate: { gt: todayColumn } },
        select: {
          studentProfileId: true,
          classId: true,
          placements: { select: { classId: true, effectiveFrom: true, effectiveTo: true } },
        },
      }),
      this.db.enrollment.findMany({
        where: {
          status: 'ACTIVE',
          endDate: { gte: todayColumn, lte: dateColumn(addDays(today, EXPIRING_DAYS)) },
        },
        select: { studentProfileId: true },
      }),
    ]);

    // Gói nối tiếp có thể bắt đầu sau cửa sổ: đọc mọi ghi danh của các học sinh sắp hết hạn.
    const expiringStudents = [
      ...new Set(
        expiringSoon.map((row) => row.studentProfileId).filter((id): id is string => !!id),
      ),
    ];
    const studentEnrollments = expiringStudents.length
      ? await this.db.enrollment.findMany({
          where: { studentProfileId: { in: expiringStudents } },
          select: {
            id: true,
            studentProfileId: true,
            classId: true,
            status: true,
            startDate: true,
            endDate: true,
            packageMonths: true,
            studentProfile: { select: { fullName: true } },
            class: { select: { name: true, monthlyFee: true } },
          },
        })
      : [];
    const enrollmentById = new Map(studentEnrollments.map((row) => [row.id, row]));
    const expiring = expiringWithoutRenewal(
      studentEnrollments.map((row) => ({
        id: row.id,
        studentId: row.studentProfileId,
        classId: row.classId,
        status: row.status,
        startDate: row.startDate ? row.startDate.toISOString().slice(0, 10) : null,
        endDate: row.endDate ? row.endDate.toISOString().slice(0, 10) : null,
        packageMonths: row.packageMonths,
        monthlyFee: money(row.class.monthlyFee),
      })),
      today,
      EXPIRING_DAYS,
    ).map((row) => {
      const source = enrollmentById.get(row.id);
      return {
        enrollmentId: row.id,
        studentId: row.studentId,
        studentName: source?.studentProfile?.fullName ?? null,
        classId: row.classId,
        className: source?.class.name ?? null,
        endDate: row.endDate,
        daysLeft: row.daysLeft,
        packageMonths: row.packageMonths,
        estimate: row.estimate,
      };
    });

    const rows = payments.map((payment) => ({
      payment,
      amount: money(payment.amount),
      order: payment.registrationOrder,
    }));
    const revenueByClass = new Map(
      groupTotals(rows, (row) => ({ key: row.order.class.id, label: row.order.class.name })).map(
        (row) => [row.key, row.total],
      ),
    );
    const enrolledByClass = new Map<string, number>();
    const studying = new Set<string>();
    for (const enrollment of current) {
      if (enrollment.studentProfileId) studying.add(enrollment.studentProfileId);
      const placement = enrollment.placements.find(
        (item) => item.effectiveFrom <= now && (!item.effectiveTo || item.effectiveTo > now),
      );
      const classId =
        placement?.classId ?? (enrollment.placements.length ? null : enrollment.classId);
      if (classId) enrolledByClass.set(classId, (enrolledByClass.get(classId) ?? 0) + 1);
    }
    const historyTotals = new Map<string, number>();
    for (const payment of history) {
      const period = vietnamDay(payment.confirmedAt).slice(0, 7);
      historyTotals.set(period, (historyTotals.get(period) ?? 0) + money(payment.amount));
    }

    return {
      range,
      previous,
      revenue: {
        total: rows.reduce((sum, row) => sum + row.amount, 0),
        receipts: rows.length,
        previousTotal: money(previousTotals._sum.amount),
        previousReceipts: previousTotals._count._all,
      },
      monthly: months.map((period) => ({ period, total: historyTotals.get(period) ?? 0 })),
      daily: dailySeries(
        rows.map((row) => ({ at: row.payment.confirmedAt, amount: row.amount })),
        range.fromDate,
        range.toDate,
      ),
      breakdown: {
        subject: groupTotals(rows, (row) => {
          const subject = row.order.class.program?.subject;
          return subject ? { key: subject, label: subject } : null;
        }),
        grade: groupTotals(rows, (row) => ({
          key: String(row.order.studentGrade),
          label: String(row.order.studentGrade),
        })),
        package: groupTotals(rows, (row) => ({
          key: String(row.order.packageMonths),
          label: String(row.order.packageMonths),
        })),
        type: groupTotals(rows, (row) => ({ key: row.order.type, label: row.order.type })),
        collector: groupTotals(rows, (row) => ({
          key: row.payment.confirmedByManager.id,
          label: row.payment.confirmedByManager.displayName ?? row.payment.confirmedByManager.email,
        })),
      },
      payments: rows.slice(0, LATEST_PAYMENTS).map((row) => ({
        id: row.payment.id,
        confirmedAt: row.payment.confirmedAt,
        receiptNumber: row.payment.receiptNumber,
        amount: row.amount,
        parentEmail: row.order.parentEmail,
        studentName: row.order.studentFullName,
        className: row.order.class.name,
        packageMonths: row.order.packageMonths,
        type: row.order.type,
        collectorName:
          row.payment.confirmedByManager.displayName ?? row.payment.confirmedByManager.email,
      })),
      topPayers: topPayers(
        rows.map((row) => ({
          parentEmail: row.order.parentEmail,
          studentName: row.order.studentFullName,
          classId: row.order.class.id,
          amount: row.amount,
          at: row.payment.confirmedAt,
        })),
        TOP_PAYERS,
      ),
      pending: {
        count: pending._count._all,
        amount: money(pending._sum.quotedAmount),
        oldestAt: pending._min.createdAt,
      },
      cancelled: { count: cancelled._count._all, amount: money(cancelled._sum.quotedAmount) },
      students: {
        studying: studying.size,
        active: activeStudents,
        created: createdStudents,
        ended: endedEnrollments,
      },
      classes: classes.map((item) => ({
        id: item.id,
        name: item.name,
        teacherName: item.teacher?.displayName ?? item.teacher?.email ?? null,
        capacity: item.capacity,
        enrolled: enrolledByClass.get(item.id) ?? 0,
        isOpen: item.isOpen,
        revenue: revenueByClass.get(item.id) ?? 0,
      })),
      expiring,
    };
  }

  /** Tab Hệ thống: tài khoản, đăng nhập, hàng đợi, thao tác nhạy cảm, dữ liệu đã xóa mềm. */
  async system(user: AuthenticatedUser, query: AdminDashboardQueryDto): Promise<unknown> {
    requireAdmin(user);
    const now = new Date();
    const today = vietnamDay(now);
    const range = resolveDashboardRange(query, today);
    const window = span(range);

    const [
      byRoleStatus,
      deletedByRole,
      createdByRole,
      sessions,
      internalUsers,
      outbox,
      outboxOpen,
      outboxLastFailed,
      dispatch,
      dispatchOpen,
      dispatchLastFailed,
      jobs,
      jobsOpen,
      jobsLastFailed,
      sensitiveCounts,
      sensitiveItems,
      deletedStudents,
      deletedClasses,
      deletedPrograms,
      deletedSubjects,
      deletedRooms,
    ] = await Promise.all([
      this.db.user.groupBy({
        by: ['role', 'status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.db.user.groupBy({
        by: ['role'],
        where: { deletedAt: { not: null } },
        _count: { _all: true },
      }),
      this.db.user.groupBy({
        by: ['role'],
        where: { deletedAt: null, createdAt: window },
        _count: { _all: true },
      }),
      this.db.authSession.findMany({
        where: { createdAt: window },
        select: { createdAt: true, user: { select: { role: true } } },
      }),
      this.db.user.findMany({
        where: { role: { not: 'PARENT' }, status: 'ACTIVE', deletedAt: null },
        select: { id: true, displayName: true, email: true, role: true },
      }),
      this.db.outboxEvent.groupBy({
        by: ['status'],
        where: { createdAt: window },
        _count: { _all: true },
      }),
      this.db.outboxEvent.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      this.db.outboxEvent.findFirst({
        where: { status: 'FAILED' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.db.notificationDispatch.groupBy({
        by: ['status'],
        where: { createdAt: window },
        _count: { _all: true },
      }),
      this.db.notificationDispatch.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      this.db.notificationDispatch.findFirst({
        where: { status: 'FAILED' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.db.gradingJob.groupBy({
        by: ['status'],
        where: { createdAt: window },
        _count: { _all: true },
      }),
      this.db.gradingJob.count({ where: { status: { in: ['QUEUED', 'PROCESSING'] } } }),
      this.db.gradingJob.findFirst({
        where: { status: 'FAILED' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.db.auditLog.groupBy({
        by: ['action'],
        where: { action: { in: SENSITIVE_ACTIONS }, createdAt: window },
        _count: { _all: true },
      }),
      this.db.auditLog.findMany({
        where: { action: { in: SENSITIVE_ACTIONS }, createdAt: window },
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          afterData: true,
          createdAt: true,
          actor: { select: { displayName: true, email: true, role: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 20,
      }),
      this.db.studentProfile.count({ where: { deletedAt: { not: null } } }),
      this.db.class.count({ where: { deletedAt: { not: null } } }),
      this.db.program.count({ where: { deletedAt: { not: null } } }),
      this.db.subject.count({ where: { deletedAt: { not: null } } }),
      this.db.room.count({ where: { deletedAt: { not: null } } }),
    ]);

    const lastLogins = internalUsers.length
      ? await this.db.authSession.groupBy({
          by: ['userId'],
          where: { userId: { in: internalUsers.map((item) => item.id) } },
          _max: { createdAt: true },
        })
      : [];
    const lastLoginBy = new Map(lastLogins.map((row) => [row.userId, row._max.createdAt]));
    const inactiveSince = new Date(now.getTime() - INACTIVE_DAYS * DAY_MS);
    const inactive = internalUsers
      .map((item) => ({ ...item, lastLoginAt: lastLoginBy.get(item.id) ?? null }))
      .filter((item) => !item.lastLoginAt || item.lastLoginAt < inactiveSince)
      .sort((a, b) => (a.lastLoginAt?.getTime() ?? 0) - (b.lastLoginAt?.getTime() ?? 0));

    const roles = [
      ...new Set([...byRoleStatus.map((row) => row.role), ...deletedByRole.map((row) => row.role)]),
    ];
    const countOf = (
      rows: { status: string; _count: { _all: number } }[],
      ...statuses: string[]
    ): number =>
      rows
        .filter((row) => statuses.includes(row.status))
        .reduce((sum, row) => sum + row._count._all, 0);
    const internalDaily = dailySeries(
      sessions
        .filter((item) => item.user.role !== 'PARENT')
        .map((item) => ({ at: item.createdAt, amount: 1 })),
      range.fromDate,
      range.toDate,
    );
    const parentDaily = dailySeries(
      sessions
        .filter((item) => item.user.role === 'PARENT')
        .map((item) => ({ at: item.createdAt, amount: 1 })),
      range.fromDate,
      range.toDate,
    );
    const kinds: Record<string, number> = {};
    for (const row of sensitiveCounts) {
      const kind = sensitiveKind(row.action);
      if (kind) kinds[kind] = (kinds[kind] ?? 0) + row._count._all;
    }
    const reasonOf = (data: Prisma.JsonValue): string | null => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      const reason = (data as Record<string, unknown>).reason;
      return typeof reason === 'string' && reason.trim() ? reason : null;
    };

    return {
      range,
      accounts: roles.map((role) => {
        const rows = byRoleStatus.filter((row) => row.role === role);
        return {
          role,
          active: countOf(rows, 'ACTIVE'),
          disabled: countOf(rows, 'DISABLED'),
          deleted: deletedByRole.find((row) => row.role === role)?._count._all ?? 0,
          created: createdByRole.find((row) => row.role === role)?._count._all ?? 0,
        };
      }),
      logins: internalDaily.map((day, index) => ({
        date: day.date,
        internal: day.total,
        parents: parentDaily[index]?.total ?? 0,
      })),
      inactiveInternal: {
        days: INACTIVE_DAYS,
        count: inactive.length,
        items: inactive.slice(0, 10),
      },
      queues: [
        {
          key: 'EMAIL',
          sent: countOf(outbox, 'SENT'),
          failed: countOf(outbox, 'FAILED'),
          pending: outboxOpen,
          lastFailedAt: outboxLastFailed?.createdAt ?? null,
        },
        {
          key: 'PUSH',
          sent: countOf(dispatch, 'SENT'),
          failed: countOf(dispatch, 'FAILED'),
          pending: dispatchOpen,
          lastFailedAt: dispatchLastFailed?.createdAt ?? null,
        },
        {
          key: 'AI_GRADING',
          sent: countOf(jobs, 'SUCCEEDED'),
          failed: countOf(jobs, 'FAILED'),
          pending: jobsOpen,
          lastFailedAt: jobsLastFailed?.createdAt ?? null,
        },
      ],
      sensitive: {
        counts: kinds,
        items: sensitiveItems.map((item) => ({
          id: item.id,
          kind: sensitiveKind(item.action),
          action: item.action,
          entityType: item.entityType,
          entityId: item.entityId,
          reason: reasonOf(item.afterData),
          occurredAt: item.createdAt,
          actorName: item.actor.displayName ?? item.actor.email,
          actorRole: item.actor.role,
        })),
      },
      deleted: [
        ...deletedByRole.map((row) => ({ entity: `USER_${row.role}`, count: row._count._all })),
        { entity: 'STUDENT', count: deletedStudents },
        { entity: 'CLASS', count: deletedClasses },
        { entity: 'PROGRAM', count: deletedPrograms },
        { entity: 'SUBJECT', count: deletedSubjects },
        { entity: 'ROOM', count: deletedRooms },
      ],
    };
  }
}
