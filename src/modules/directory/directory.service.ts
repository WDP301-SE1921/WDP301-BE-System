import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { AppError } from '../../common/errors/app.error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { DatabaseService } from '../../database/orm/database.service';
import {
  CreateStaffAccountDto,
  DashboardQueryDto,
  ListAccountsDto,
  UpdateParentAccountDto,
  UpdateStaffAccountDto,
} from './dto/directory.dto';

const PASSWORD_HASH_ROUNDS = 12;
const BCRYPT_MAX_BYTES = 72;
const HCM_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

type ManagedRole = Extract<UserRole, 'STAFF' | 'TEACHER'>;

// The password hash must never leave the service, so every query selects these columns explicitly.
const accountSelect = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class DirectoryService {
  constructor(private readonly db: DatabaseService) {}

  async listAccounts(
    user: AuthenticatedUser,
    role: ManagedRole,
    query: ListAccountsDto,
  ): Promise<unknown> {
    // Teachers are also read by staff (e.g. to see who teaches a class); staff accounts are manager-only.
    this.requireRoles(
      user,
      ...(role === 'TEACHER' ? (['MANAGER', 'STAFF'] as const) : ['MANAGER' as const]),
    );
    const where = this.accountWhere(role, query);
    const [items, total] = await Promise.all([
      this.db.user.findMany({
        where,
        select: accountSelect,
        orderBy: [{ displayName: 'asc' }, { email: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.user.count({ where }),
    ]);
    return { items, page: query.page, limit: query.limit, total };
  }

  async getAccount(user: AuthenticatedUser, role: ManagedRole, id: string): Promise<unknown> {
    this.requireRoles(
      user,
      ...(role === 'TEACHER' ? (['MANAGER', 'STAFF'] as const) : ['MANAGER' as const]),
    );
    const account = await this.db.user.findFirst({ where: { id, role }, select: accountSelect });
    this.assert(account, 'ACCOUNT_NOT_FOUND', 'Account not found', HttpStatus.NOT_FOUND);
    return account;
  }

  async createAccount(
    user: AuthenticatedUser,
    role: ManagedRole,
    input: CreateStaffAccountDto,
  ): Promise<unknown> {
    this.requireRoles(user, 'MANAGER');
    this.assert(
      Buffer.byteLength(input.password, 'utf8') <= BCRYPT_MAX_BYTES,
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
            role,
            status: 'ACTIVE',
            // Accounts issued by the manager are trusted; there is no email-verification step for staff.
            emailVerifiedAt: new Date(),
          },
          select: accountSelect,
        });
        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            action: `${role}_ACCOUNT_CREATE`,
            entityType: 'User',
            entityId: created.id,
            afterData: { email: created.email, role },
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

  async updateAccount(
    user: AuthenticatedUser,
    role: ManagedRole,
    id: string,
    input: UpdateStaffAccountDto,
  ): Promise<unknown> {
    this.requireRoles(user, 'MANAGER');
    return this.db.$transaction(async (tx) => {
      const before = await tx.user.findFirst({ where: { id, role }, select: accountSelect });
      this.assert(before, 'ACCOUNT_NOT_FOUND', 'Account not found', HttpStatus.NOT_FOUND);
      const updated = await tx.user.update({
        where: { id },
        data: {
          ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
          ...(input.status === undefined ? {} : { status: input.status }),
        },
        select: accountSelect,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: `${role}_ACCOUNT_UPDATE`,
          entityType: 'User',
          entityId: id,
          beforeData: { displayName: before.displayName, status: before.status },
          afterData: { displayName: updated.displayName, status: updated.status },
        },
      });
      return updated;
    });
  }

  async listParents(user: AuthenticatedUser, query: ListAccountsDto): Promise<unknown> {
    this.requireRoles(user, 'MANAGER');
    const where = this.accountWhere('PARENT', query);
    const [items, total] = await Promise.all([
      this.db.user.findMany({
        where,
        select: {
          ...accountSelect,
          parentProfile: {
            select: { id: true, phone: true, _count: { select: { students: true } } },
          },
        },
        orderBy: [{ email: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.user.count({ where }),
    ]);
    return { items, page: query.page, limit: query.limit, total };
  }

  async getParent(user: AuthenticatedUser, id: string): Promise<unknown> {
    this.requireRoles(user, 'MANAGER');
    const parent = await this.db.user.findFirst({
      where: { id, role: 'PARENT' },
      select: {
        ...accountSelect,
        parentProfile: {
          select: {
            id: true,
            phone: true,
            students: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    this.assert(parent, 'PARENT_NOT_FOUND', 'Parent account not found', HttpStatus.NOT_FOUND);
    return parent;
  }

  /** Managers edit contact fields and status only; parents own their email and password. */
  async updateParent(
    user: AuthenticatedUser,
    id: string,
    input: UpdateParentAccountDto,
  ): Promise<unknown> {
    this.requireRoles(user, 'MANAGER');
    await this.db.$transaction(async (tx) => {
      const before = await tx.user.findFirst({
        where: { id, role: 'PARENT' },
        select: { ...accountSelect, parentProfile: { select: { id: true, phone: true } } },
      });
      this.assert(before, 'PARENT_NOT_FOUND', 'Parent account not found', HttpStatus.NOT_FOUND);
      this.assert(
        before.parentProfile,
        'PARENT_PROFILE_NOT_FOUND',
        'Parent profile not found',
        HttpStatus.NOT_FOUND,
      );
      if (input.displayName !== undefined || input.status !== undefined)
        await tx.user.update({
          where: { id },
          data: {
            ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
            ...(input.status === undefined ? {} : { status: input.status }),
          },
        });
      if (input.phone !== undefined)
        await tx.parentProfile.update({
          where: { id: before.parentProfile.id },
          data: { phone: input.phone || null },
        });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'PARENT_ACCOUNT_UPDATE',
          entityType: 'User',
          entityId: id,
          beforeData: {
            displayName: before.displayName,
            status: before.status,
            phone: before.parentProfile.phone,
          },
          afterData: { ...input },
        },
      });
    });
    return this.getParent(user, id);
  }

  /**
   * Revenue counts only confirmed payments whose confirmation falls in the range; drafts and
   * cancelled registrations never contribute. Dates are center-local (UTC+7) calendar days.
   */
  async dashboard(user: AuthenticatedUser, query: DashboardQueryDto): Promise<unknown> {
    this.requireRoles(user, 'MANAGER');
    const today = localToday();
    const fromDate = query.fromDate ? query.fromDate.slice(0, 10) : `${today.slice(0, 8)}01`;
    const toDate = query.toDate ? query.toDate.slice(0, 10) : today;
    this.assert(
      fromDate <= toDate,
      'INVALID_DATE_RANGE',
      'fromDate must not be after toDate',
      HttpStatus.BAD_REQUEST,
    );
    const from = startOfLocalDay(fromDate);
    const toExclusive = new Date(startOfLocalDay(toDate).getTime() + DAY_MS);
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const confirmedAt = { gte: from, lt: toExclusive };
    const [revenue, students, studying, parents, teachers, staff, registrations] =
      await Promise.all([
        this.db.payment.aggregate({
          where: { status: 'CONFIRMED', confirmedAt },
          _sum: { amount: true },
          _count: true,
        }),
        this.db.studentProfile.count({ where: { status: 'ACTIVE' } }),
        this.db.studentProfile.count({
          where: {
            status: 'ACTIVE',
            enrollments: {
              some: {
                status: 'ACTIVE',
                startDate: { lte: todayDate },
                endDate: { gt: todayDate },
              },
            },
          },
        }),
        this.db.user.count({ where: { role: 'PARENT', status: 'ACTIVE' } }),
        this.db.user.count({ where: { role: 'TEACHER', status: 'ACTIVE' } }),
        this.db.user.count({ where: { role: 'STAFF', status: 'ACTIVE' } }),
        this.db.registrationOrder.groupBy({ by: ['status'], _count: true }),
      ]);
    const byStatus = Object.fromEntries(registrations.map((row) => [row.status, row._count]));
    return {
      range: { fromDate, toDate },
      tuition: {
        confirmedAmount: (revenue._sum.amount ?? new Prisma.Decimal(0)).toString(),
        currency: 'VND',
        paymentCount: revenue._count,
      },
      counts: {
        activeStudents: students,
        studyingStudents: studying,
        activeParents: parents,
        activeTeachers: teachers,
        activeStaff: staff,
      },
      registrations: {
        draft: byStatus.DRAFT ?? 0,
        completed: byStatus.COMPLETED ?? 0,
        cancelled: byStatus.CANCELLED ?? 0,
      },
    };
  }

  private accountWhere(role: UserRole, query: ListAccountsDto): Prisma.UserWhereInput {
    const search = query.search?.trim();
    return {
      role,
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? { OR: [{ email: { contains: search } }, { displayName: { contains: search } }] }
        : {}),
    };
  }

  private requireRoles(user: AuthenticatedUser, ...roles: UserRole[]): void {
    this.assert(
      roles.includes(user.role),
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
  ): asserts condition {
    if (!condition) throw new AppError(code, message, status);
  }
}

function localToday(): string {
  return new Date(Date.now() + HCM_OFFSET_MS).toISOString().slice(0, 10);
}

function startOfLocalDay(day: string): Date {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() - HCM_OFFSET_MS);
}
