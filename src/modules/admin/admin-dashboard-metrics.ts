import { HttpStatus } from '@nestjs/common';

import { AppError } from '../../common/errors/app.error';

/**
 * Hàm tính thuần cho dashboard Admin tổng (không truy vấn DB, có unit test).
 * Ngày đều là ngày của trung tâm (UTC+7) dạng `YYYY-MM-DD`.
 */

const DAY_MS = 86_400_000;
const HCM_OFFSET_MS = 7 * 3_600_000;
const MAX_RANGE_DAYS = 366;

/** Ngày trung tâm của một thời điểm. */
export function vietnamDay(value: Date): string {
  return new Date(value.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 10);
}

/** 00:00 giờ trung tâm của một ngày, đổi về thời điểm UTC. */
export function startOfVietnamDay(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - HCM_OFFSET_MS);
}

/** Cột `@db.Date` của Prisma lưu nửa đêm UTC của ngày đó. */
export function dateColumn(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00.000Z`) / DAY_MS;

function monthEnd(day: string): string {
  const [year, month] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export interface DayRange {
  fromDate: string;
  toDate: string;
}

/**
 * Kỳ thống kê: mặc định đầu tháng → hôm nay; ngày cuối không vượt quá hôm nay để so sánh
 * luôn theo số ngày đã qua.
 */
export function resolveDashboardRange(
  input: { fromDate?: string; toDate?: string },
  today: string,
): DayRange {
  const fromDate = input.fromDate?.slice(0, 10) ?? `${today.slice(0, 8)}01`;
  const requestedTo = input.toDate?.slice(0, 10) ?? today;
  const toDate = requestedTo > today ? today : requestedTo;
  if (fromDate > toDate)
    throw new AppError(
      'INVALID_DATE_RANGE',
      'fromDate must not be after toDate (or today)',
      HttpStatus.BAD_REQUEST,
    );
  if (dayNumber(toDate) - dayNumber(fromDate) + 1 > MAX_RANGE_DAYS)
    throw new AppError(
      'DATE_RANGE_TOO_LONG',
      `The range must not exceed ${MAX_RANGE_DAYS} days`,
      HttpStatus.BAD_REQUEST,
    );
  return { fromDate, toDate };
}

/**
 * Kỳ so sánh cùng số ngày: kỳ bắt đầu ngày 1 trong một tháng → cùng các ngày của tháng trước;
 * kỳ khác → lùi đúng độ dài kỳ.
 */
export function previousRange(fromDate: string, toDate: string): DayRange {
  if (fromDate.endsWith('-01') && fromDate.slice(0, 7) === toDate.slice(0, 7)) {
    const [year, month] = fromDate.split('-').map(Number);
    const prevFrom = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
    const sameDay = `${prevFrom.slice(0, 8)}${toDate.slice(8, 10)}`;
    const lastDay = monthEnd(prevFrom);
    return { fromDate: prevFrom, toDate: sameDay > lastDay ? lastDay : sameDay };
  }
  const length = dayNumber(toDate) - dayNumber(fromDate) + 1;
  return { fromDate: addDays(fromDate, -length), toDate: addDays(fromDate, -1) };
}

/** `n` tháng gần nhất (`YYYY-MM`), kết thúc ở tháng của `today`. */
export function monthKeys(today: string, n: number): string[] {
  const [year, month] = today.split('-').map(Number);
  return Array.from({ length: n }, (_, index) =>
    new Date(Date.UTC(year, month - n + index, 1)).toISOString().slice(0, 7),
  );
}

/** Tổng tiền theo từng ngày trung tâm, đủ mọi ngày của kỳ. */
export function dailySeries(
  rows: { at: Date; amount: number }[],
  fromDate: string,
  toDate: string,
): { date: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const day = vietnamDay(row.at);
    totals.set(day, (totals.get(day) ?? 0) + row.amount);
  }
  const length = dayNumber(toDate) - dayNumber(fromDate) + 1;
  return Array.from({ length }, (_, index) => {
    const date = addDays(fromDate, index);
    return { date, total: totals.get(date) ?? 0 };
  });
}

export interface GroupRow {
  key: string;
  label: string;
  total: number;
  receipts: number;
}

/** Gom tiền theo nhóm (bỏ dòng không xếp được nhóm), sắp giảm dần. */
export function groupTotals<T extends { amount: number }>(
  rows: T[],
  pick: (row: T) => { key: string; label: string } | null,
): GroupRow[] {
  const groups = new Map<string, GroupRow>();
  for (const row of rows) {
    const group = pick(row);
    if (!group) continue;
    const current = groups.get(group.key) ?? { ...group, total: 0, receipts: 0 };
    current.total += row.amount;
    current.receipts += 1;
    groups.set(group.key, current);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

export interface PayerRow {
  email: string;
  total: number;
  receipts: number;
  students: number;
  classes: number;
  lastAt: Date;
}

/** Phụ huynh đóng nhiều nhất, gộp theo email (không phân biệt hoa thường). */
export function topPayers(
  rows: { parentEmail: string; studentName: string; classId: string; amount: number; at: Date }[],
  limit: number,
): PayerRow[] {
  const payers = new Map<
    string,
    { total: number; receipts: number; students: Set<string>; classes: Set<string>; lastAt: Date }
  >();
  for (const row of rows) {
    const email = row.parentEmail.trim().toLowerCase();
    const current = payers.get(email) ?? {
      total: 0,
      receipts: 0,
      students: new Set<string>(),
      classes: new Set<string>(),
      lastAt: row.at,
    };
    current.total += row.amount;
    current.receipts += 1;
    current.students.add(row.studentName.trim().toLowerCase());
    current.classes.add(row.classId);
    if (row.at > current.lastAt) current.lastAt = row.at;
    payers.set(email, current);
  }
  return [...payers.entries()]
    .map(([email, row]) => ({
      email,
      total: row.total,
      receipts: row.receipts,
      students: row.students.size,
      classes: row.classes.size,
      lastAt: row.lastAt,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export interface EnrollmentLike {
  id: string;
  studentId: string | null;
  classId: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  packageMonths: number;
  monthlyFee: number;
}

export interface ExpiringRow extends EnrollmentLike {
  endDate: string;
  daysLeft: number;
  /** Ước tính gia hạn = học phí tháng của lớp × số tháng gói cũ. */
  estimate: number;
}

/**
 * Gói đang học hết hạn trong `withinDays` ngày tới và chưa có gói nối tiếp
 * (cùng học sinh, cùng lớp, bắt đầu từ ngày hết hạn trở đi, chưa kết thúc).
 */
export function expiringWithoutRenewal(
  enrollments: EnrollmentLike[],
  today: string,
  withinDays: number,
): ExpiringRow[] {
  const limit = addDays(today, withinDays);
  const rows: ExpiringRow[] = [];
  for (const enrollment of enrollments) {
    const endDate = enrollment.endDate?.slice(0, 10);
    if (enrollment.status !== 'ACTIVE' || !endDate || endDate < today || endDate > limit) continue;
    const renewed = enrollments.some(
      (other) =>
        other.id !== enrollment.id &&
        other.status !== 'ENDED' &&
        !!enrollment.studentId &&
        other.studentId === enrollment.studentId &&
        other.classId === enrollment.classId &&
        (other.startDate?.slice(0, 10) ?? '') >= endDate,
    );
    if (renewed) continue;
    rows.push({
      ...enrollment,
      endDate,
      daysLeft: dayNumber(endDate) - dayNumber(today),
      estimate: enrollment.monthlyFee * enrollment.packageMonths,
    });
  }
  return rows.sort((a, b) => a.endDate.localeCompare(b.endDate));
}

export type SensitiveKind = 'DELETE' | 'RESTORE' | 'CANCEL' | 'TEACHER' | 'SECURITY' | 'END_STUDY';

const SENSITIVE: Record<string, SensitiveKind> = {
  ADMIN_RECORD_DELETE: 'DELETE',
  PARENT_ACCOUNT_DELETE: 'DELETE',
  PROGRAM_DELETE: 'DELETE',
  ACCOUNT_SELF_DELETED: 'DELETE',
  ADMIN_RECORD_RESTORE: 'RESTORE',
  REGISTRATION_CANCEL_DRAFT: 'CANCEL',
  CLASS_SESSION_CANCELLED: 'CANCEL',
  CLASS_TEACHER_ASSIGNED: 'TEACHER',
  SESSION_SUBSTITUTE_ASSIGNED: 'TEACHER',
  ADMIN_SESSIONS_REVOKE: 'SECURITY',
  ADMIN_PASSWORD_RESET_SENT: 'SECURITY',
  PASSWORD_RESET: 'SECURITY',
  STUDENT_END_STUDY: 'END_STUDY',
  ENROLLMENT_END: 'END_STUDY',
};

/** Mã audit thuộc nhóm thao tác nhạy cảm Admin cần theo dõi; thao tác thường → null. */
export function sensitiveKind(action: string): SensitiveKind | null {
  return SENSITIVE[action] ?? null;
}

/** Danh sách mã audit nhạy cảm (để lọc trong truy vấn). */
export const SENSITIVE_ACTIONS = Object.keys(SENSITIVE);
