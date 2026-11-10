import type { UserRole } from '@prisma/client';

/**
 * Quyền của ADMIN (Admin tổng — vai trò cao nhất):
 * - Được làm mọi việc mà MANAGER **hoặc** STAFF được làm (toàn bộ khối vận hành).
 * - Cộng thêm các API riêng ở module `admin` (kiểm bằng `isAdmin`).
 * - Không đóng vai TEACHER / CURRICULUM_DESIGNER / PARENT: các việc gắn với chính người làm
 *   (điểm danh lớp mình dạy, soạn giáo trình của mình, hồ sơ con) vẫn thuộc vai trò đó.
 * Mọi kiểm quyền theo vai trò phải đi qua các hàm ở file này, không so sánh `user.role` trực tiếp.
 */
const BACK_OFFICE: readonly UserRole[] = ['MANAGER', 'STAFF'];

/** Vai trò `role` có được dùng chức năng mở cho `allowed` không (ADMIN qua mọi chỗ QL / NV). */
export function roleAllowed(role: UserRole, allowed: readonly UserRole[]): boolean {
  if (allowed.includes(role)) return true;
  return role === 'ADMIN' && allowed.some((item) => BACK_OFFICE.includes(item));
}

/** Quyền ở mức Quản lý: MANAGER hoặc ADMIN. */
export function isManagerOrAdmin(role: UserRole): boolean {
  return role === 'MANAGER' || role === 'ADMIN';
}

/** Khối vận hành: MANAGER, STAFF hoặc ADMIN. */
export function isBackOffice(role: UserRole): boolean {
  return role === 'MANAGER' || role === 'STAFF' || role === 'ADMIN';
}

/** Thao tác như Nhân viên (STAFF hoặc ADMIN). */
export function actsAsStaff(role: UserRole): boolean {
  return role === 'STAFF' || role === 'ADMIN';
}

export function isAdmin(user: { role: UserRole }): boolean {
  return user.role === 'ADMIN';
}
