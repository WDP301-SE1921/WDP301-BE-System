import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { AppError } from '../../common/errors/app.error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { DatabaseService } from '../../database/orm/database.service';
import { AuthService } from '../auth/auth.service';
import { assertCanChangeStatus, requireAdmin } from './admin-rules';
import { AdminRecordsService } from './admin-records.service';
import type {
  AdminAccountQueryDto,
  CreateAdminAccountDto,
  SetAccountStatusDto,
  UpdateAdminAccountDto,
} from './dto/admin.dto';

const PASSWORD_HASH_ROUNDS = 12;
const BCRYPT_MAX_BYTES = 72;

// Không bao giờ chọn passwordHash.
const accountSelect = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  deletedById: true,
  deleteReason: true,
} satisfies Prisma.UserSelect;

function notFound(): AppError {
  return new AppError('ACCOUNT_NOT_FOUND', 'Account not found', HttpStatus.NOT_FOUND);
}

/** Bản ghi đã xóa mềm chỉ xem và khôi phục được. */
function assertNotDeleted(account: { deletedAt: Date | null }): void {
  if (account.deletedAt)
    throw new AppError(
      'RECORD_DELETED',
      'Record is deleted; restore it first',
      HttpStatus.CONFLICT,
    );
}

@Injectable()
export class AdminAccountsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
    private readonly records: AdminRecordsService,
  ) {}

  /** Tên người xóa theo id. */
  private async deleterNames(ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))] as string[];
    if (!unique.length) return new Map();
    const users = await this.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, displayName: true, email: true },
    });
    return new Map(users.map((u) => [u.id, u.displayName ?? u.email]));
  }

  async list(user: AuthenticatedUser, query: AdminAccountQueryDto): Promise<unknown> {
    requireAdmin(user);
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search } },
              { displayName: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.user.findMany({
        where,
        select: accountSelect,
        orderBy: [{ createdAt: 'desc' }, { email: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.user.count({ where }),
    ]);
    const names = await this.deleterNames(items.map((item) => item.deletedById));
    const rows = await this.records.withLifecycle(
      'account',
      items.map((item) => ({
        ...item,
        deletedBy: item.deletedById ? (names.get(item.deletedById) ?? null) : null,
      })),
      user.id,
    );
    return { items: rows, page: query.page, limit: query.limit, total };
  }

  async get(user: AuthenticatedUser, id: string): Promise<unknown> {
    requireAdmin(user);
    const account = await this.db.user.findUnique({
      where: { id },
      select: {
        ...accountSelect,
        parentProfile: { select: { phone: true } },
        sessions: {
          where: { revokedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true, createdAt: true, updatedAt: true, expiresAt: true },
          orderBy: { updatedAt: 'desc' },
        },
      },
    });
    if (!account) throw notFound();
    const { parentProfile, sessions, ...rest } = account;
    const names = await this.deleterNames([account.deletedById]);
    const [withLife] = await this.records.withLifecycle('account', [rest], user.id);
    return {
      ...withLife,
      deletedBy: account.deletedById ? (names.get(account.deletedById) ?? null) : null,
      phone: parentProfile?.phone ?? null,
      isSelf: account.id === user.id,
      sessions: sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt,
        lastActiveAt: session.updatedAt,
        expiresAt: session.expiresAt,
        isCurrent: session.id === user.sessionId,
      })),
    };
  }

  async create(user: AuthenticatedUser, input: CreateAdminAccountDto): Promise<unknown> {
    requireAdmin(user);
    if (Buffer.byteLength(input.password, 'utf8') > BCRYPT_MAX_BYTES)
      throw new AppError(
        'VALIDATION_ERROR',
        'Password must be at most 72 UTF-8 bytes',
        HttpStatus.BAD_REQUEST,
      );
    const passwordHash = await bcrypt.hash(input.password, PASSWORD_HASH_ROUNDS);
    try {
      return await this.db.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: input.email,
            passwordHash,
            displayName: input.displayName,
            role: input.role,
            status: 'ACTIVE',
            // Tài khoản do Admin cấp đăng nhập được ngay bằng mật khẩu ban đầu.
            emailVerifiedAt: new Date(),
          },
          select: accountSelect,
        });
        // Phụ huynh cần hồ sơ phụ huynh (con, đăng ký gắn vào đây), giống luồng tự đăng ký.
        if (created.role === 'PARENT')
          await tx.parentProfile.create({
            data: { userId: created.id, phone: input.phone ?? null },
          });
        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            action: 'ADMIN_ACCOUNT_CREATE',
            entityType: 'User',
            entityId: created.id,
            afterData: {
              email: created.email,
              role: created.role,
              displayName: created.displayName,
            },
          },
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new AppError('AUTH_EMAIL_EXISTS', 'Email is already registered', HttpStatus.CONFLICT);
      throw error;
    }
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateAdminAccountDto,
  ): Promise<unknown> {
    requireAdmin(user);
    return this.db.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id }, select: accountSelect });
      if (!before) throw notFound();
      assertNotDeleted(before);
      const updated = await tx.user.update({
        where: { id },
        data: { displayName: input.displayName },
        select: accountSelect,
      });
      if (before.displayName !== updated.displayName)
        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            action: 'ADMIN_ACCOUNT_UPDATE',
            entityType: 'User',
            entityId: id,
            beforeData: { displayName: before.displayName },
            afterData: { displayName: updated.displayName },
          },
        });
      return updated;
    });
  }

  /** Khóa / mở tài khoản kèm lý do. Khóa thì thu hồi mọi phiên đăng nhập. */
  async setStatus(
    user: AuthenticatedUser,
    id: string,
    input: SetAccountStatusDto,
  ): Promise<unknown> {
    requireAdmin(user);
    return this.db.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id }, select: accountSelect });
      if (!target) throw notFound();
      assertNotDeleted(target);
      const activeAdminCount = await tx.user.count({
        where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
      });
      assertCanChangeStatus({
        actorId: user.id,
        target,
        nextStatus: input.status,
        activeAdminCount,
      });
      const updated = await tx.user.update({
        where: { id },
        data: { status: input.status },
        select: accountSelect,
      });
      let revokedSessions = 0;
      if (input.status === 'DISABLED') {
        const result = await tx.authSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        revokedSessions = result.count;
      }
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: input.status === 'DISABLED' ? 'ADMIN_ACCOUNT_DISABLE' : 'ADMIN_ACCOUNT_ENABLE',
          entityType: 'User',
          entityId: id,
          beforeData: { status: target.status },
          afterData: { status: updated.status, reason: input.reason, revokedSessions },
        },
      });
      return updated;
    });
  }

  /** Gửi email đặt lại mật khẩu (dùng chung luồng quên mật khẩu). */
  async sendPasswordReset(user: AuthenticatedUser, id: string): Promise<unknown> {
    requireAdmin(user);
    const account = await this.db.user.findUnique({ where: { id }, select: accountSelect });
    if (!account) throw notFound();
    assertNotDeleted(account);
    if (account.status !== 'ACTIVE')
      throw new AppError('ACCOUNT_DISABLED', 'Account is disabled', HttpStatus.CONFLICT);
    await this.auth.forgotPassword(account.email);
    await this.db.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'ADMIN_PASSWORD_RESET_SENT',
        entityType: 'User',
        entityId: id,
        afterData: { email: account.email },
      },
    });
    return { sent: true };
  }

  /** Thu hồi mọi phiên; với chính mình thì giữ phiên đang dùng. */
  async revokeSessions(user: AuthenticatedUser, id: string): Promise<unknown> {
    requireAdmin(user);
    const account = await this.db.user.findUnique({ where: { id }, select: { id: true } });
    if (!account) throw notFound();
    return this.db.$transaction(async (tx) => {
      const result = await tx.authSession.updateMany({
        where: {
          userId: id,
          revokedAt: null,
          ...(id === user.id ? { id: { not: user.sessionId } } : {}),
        },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'ADMIN_SESSIONS_REVOKE',
          entityType: 'User',
          entityId: id,
          afterData: { revokedSessions: result.count },
        },
      });
      return { revoked: result.count };
    });
  }
}
