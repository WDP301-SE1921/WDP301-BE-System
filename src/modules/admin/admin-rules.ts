import { HttpStatus } from '@nestjs/common';
import type { UserRole, UserStatus } from '@prisma/client';

import { isAdmin } from '../../common/auth/role-access';
import { AppError } from '../../common/errors/app.error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

/** Chỉ Admin tổng; vai trò khác → 403 ADMIN_ONLY. */
export function requireAdmin(user: AuthenticatedUser): void {
  if (!isAdmin(user))
    throw new AppError('ADMIN_ONLY', 'Only the system admin can do this', HttpStatus.FORBIDDEN);
}

export interface StatusChangeInput {
  actorId: string;
  target: { id: string; role: UserRole; status: UserStatus };
  nextStatus: 'ACTIVE' | 'DISABLED';
  /** Số ADMIN đang ACTIVE (kể cả target nếu target là ADMIN đang hoạt động). */
  activeAdminCount: number;
}

/**
 * Quy tắc khóa / mở tài khoản của Admin tổng:
 * không đổi sang chính trạng thái hiện tại, không tự khóa, luôn còn ít nhất một ADMIN hoạt động.
 */
export function assertCanChangeStatus(input: StatusChangeInput): void {
  const { actorId, target, nextStatus, activeAdminCount } = input;
  if (target.status === nextStatus)
    throw new AppError(
      'ACCOUNT_STATUS_UNCHANGED',
      'Account already has this status',
      HttpStatus.CONFLICT,
    );
  if (nextStatus !== 'DISABLED') return;
  if (target.id === actorId)
    throw new AppError(
      'ADMIN_SELF_LOCK',
      'You cannot disable your own account',
      HttpStatus.CONFLICT,
    );
  if (target.role === 'ADMIN' && target.status === 'ACTIVE' && activeAdminCount <= 1)
    throw new AppError(
      'ADMIN_LAST_ACTIVE',
      'At least one active admin account must remain',
      HttpStatus.CONFLICT,
    );
}

export type ServiceState = 'AVAILABLE' | 'DEGRADED' | 'NOT_CONFIGURED';

/** Trạng thái email: chưa có SMTP → chưa cấu hình; có email lỗi trong 24 giờ → cần kiểm tra. */
export function emailServiceState(smtpConfigured: boolean, failedLastDay: number): ServiceState {
  if (!smtpConfigured) return 'NOT_CONFIGURED';
  return failedLastDay > 0 ? 'DEGRADED' : 'AVAILABLE';
}
