import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { roleAllowed } from '../../common/auth/role-access';
import { AppError } from '../../common/errors/app.error';
import { pageResult } from '../../common/pagination';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { DatabaseService } from '../../database/orm/database.service';
import type {
  CenterClosureDto,
  CenterClosureQueryDto,
  UpdateCenterClosureDto,
} from './curriculum-scheduling.dto';
import { vietnamDayStart, type ClosureRange } from './session-lesson-plan';

const DAY_MS = 86_400_000;
const MAX_CLOSURE_DAYS = 92;
const AFFECTED_LIMIT = 500;
const STAFF_ROLES: AuthenticatedUser['role'][] = [
  'MANAGER',
  'STAFF',
  'TEACHER',
  'CURRICULUM_DESIGNER',
];

function localDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Closures overlapping `[from, to]` (local dates), as plain date ranges. */
export async function closuresBetween(
  db: Pick<Prisma.TransactionClient, 'centerClosure'>,
  from: string,
  to: string,
): Promise<ClosureRange[]> {
  const rows = await db.centerClosure.findMany({
    where: { fromDate: { lte: localDate(to) }, toDate: { gte: localDate(from) } },
    select: { fromDate: true, toDate: true },
    orderBy: [{ fromDate: 'asc' }, { id: 'asc' }],
  });
  return rows.map((row) => ({ fromDate: dateOnly(row.fromDate), toDate: dateOnly(row.toDate) }));
}

type ClosureRow = Prisma.CenterClosureGetPayload<object>;

/**
 * Center-wide days off (B5). Adding or moving a closure never cancels sessions: the response
 * lists the scheduled sessions inside it so the manager can bulk-cancel them (B6).
 */
@Injectable()
export class CenterClosureService {
  constructor(private readonly db: DatabaseService) {}

  async list(user: AuthenticatedUser, query: CenterClosureQueryDto): Promise<unknown> {
    this.requireRole(user, ...STAFF_ROLES);
    if (query.fromDate && query.toDate) this.assertOrder(query.fromDate, query.toDate);
    const where: Prisma.CenterClosureWhereInput = {
      ...(query.fromDate ? { toDate: { gte: localDate(query.fromDate) } } : {}),
      ...(query.toDate ? { fromDate: { lte: localDate(query.toDate) } } : {}),
    };
    return pageResult(
      query,
      this.db.centerClosure
        .findMany({
          where,
          orderBy: [{ fromDate: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        })
        .then((rows) => rows.map(present)),
      () => this.db.centerClosure.count({ where }),
    );
  }

  async create(user: AuthenticatedUser, input: CenterClosureDto): Promise<unknown> {
    this.requireRole(user, 'MANAGER');
    this.assertRange(input.fromDate, input.toDate);
    return this.db.$transaction(async (tx) => {
      await this.assertNoOverlap(tx, input.fromDate, input.toDate);
      const closure = await tx.centerClosure.create({
        data: {
          fromDate: localDate(input.fromDate),
          toDate: localDate(input.toDate),
          reason: input.reason.trim(),
          createdById: user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'CENTER_CLOSURE_CREATED',
          entityType: 'CenterClosure',
          entityId: closure.id,
          afterData: present(closure),
        },
      });
      return this.withAffected(tx, closure);
    });
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdateCenterClosureDto,
  ): Promise<unknown> {
    this.requireRole(user, 'MANAGER');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM center_closures WHERE id = ${id} FOR UPDATE`;
      const current = await tx.centerClosure.findUnique({ where: { id } });
      this.assert(
        current,
        'CENTER_CLOSURE_NOT_FOUND',
        'Center closure not found',
        HttpStatus.NOT_FOUND,
      );
      this.assert(
        current.revision === input.expectedRevision,
        'REVISION_CONFLICT',
        'Center closure changed; reload it',
      );
      const fromDate = input.fromDate ?? dateOnly(current.fromDate);
      const toDate = input.toDate ?? dateOnly(current.toDate);
      this.assertRange(fromDate, toDate);
      await this.assertNoOverlap(tx, fromDate, toDate, id);
      const closure = await tx.centerClosure.update({
        where: { id },
        data: {
          fromDate: localDate(fromDate),
          toDate: localDate(toDate),
          ...(input.reason === undefined ? {} : { reason: input.reason.trim() }),
          revision: { increment: 1 },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'CENTER_CLOSURE_UPDATED',
          entityType: 'CenterClosure',
          entityId: id,
          beforeData: present(current),
          afterData: present(closure),
        },
      });
      return this.withAffected(tx, closure);
    });
  }

  async remove(user: AuthenticatedUser, id: string): Promise<unknown> {
    this.requireRole(user, 'MANAGER');
    return this.db.$transaction(async (tx) => {
      const current = await tx.centerClosure.findUnique({ where: { id } });
      this.assert(
        current,
        'CENTER_CLOSURE_NOT_FOUND',
        'Center closure not found',
        HttpStatus.NOT_FOUND,
      );
      await tx.centerClosure.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'CENTER_CLOSURE_DELETED',
          entityType: 'CenterClosure',
          entityId: id,
          beforeData: present(current),
        },
      });
      return { id, deleted: true };
    });
  }

  /** Scheduled sessions inside the closure, `[fromDate 00:00+07, toDate+1 00:00+07)`. */
  private async withAffected(tx: Prisma.TransactionClient, closure: ClosureRow): Promise<unknown> {
    const where: Prisma.ClassSessionWhereInput = {
      status: 'SCHEDULED',
      startsAt: {
        gte: vietnamDayStart(dateOnly(closure.fromDate)),
        lt: new Date(vietnamDayStart(dateOnly(closure.toDate)).getTime() + DAY_MS),
      },
    };
    const [rows, affectedTotal] = await Promise.all([
      tx.classSession.findMany({
        where,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: AFFECTED_LIMIT,
        select: {
          id: true,
          classId: true,
          startsAt: true,
          endsAt: true,
          revision: true,
          class: { select: { name: true } },
          lesson: { select: { id: true, title: true } },
        },
      }),
      tx.classSession.count({ where }),
    ]);
    return {
      ...present(closure),
      affectedSessions: rows.map(({ class: classroom, ...row }) => ({
        ...row,
        className: classroom.name,
      })),
      affectedTotal,
    };
  }

  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    fromDate: string,
    toDate: string,
    exceptId?: string,
  ): Promise<void> {
    const overlap = await tx.centerClosure.findFirst({
      where: {
        fromDate: { lte: localDate(toDate) },
        toDate: { gte: localDate(fromDate) },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      orderBy: { fromDate: 'asc' },
    });
    this.assert(
      !overlap,
      'CENTER_CLOSURE_OVERLAP',
      'These dates overlap another center closure',
      HttpStatus.CONFLICT,
      overlap ? present(overlap) : undefined,
    );
  }

  private assertRange(fromDate: string, toDate: string): void {
    this.assertOrder(fromDate, toDate);
    const days =
      Math.round((localDate(toDate).getTime() - localDate(fromDate).getTime()) / DAY_MS) + 1;
    this.assert(
      days <= MAX_CLOSURE_DAYS,
      'CLOSURE_TOO_LONG',
      `A closure lasts at most ${MAX_CLOSURE_DAYS} days`,
      HttpStatus.BAD_REQUEST,
    );
  }

  private assertOrder(fromDate: string, toDate: string): void {
    this.assert(
      fromDate <= toDate,
      'INVALID_DATE_RANGE',
      'fromDate must be on or before toDate',
      HttpStatus.BAD_REQUEST,
    );
  }

  private requireRole(user: AuthenticatedUser, ...roles: AuthenticatedUser['role'][]): void {
    this.assert(
      roleAllowed(user.role, roles),
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
    details?: unknown,
  ): asserts condition {
    if (!condition) throw new AppError(code, message, status, details);
  }
}

function present(row: ClosureRow): {
  id: string;
  fromDate: string;
  toDate: string;
  reason: string;
  createdById: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: row.id,
    fromDate: dateOnly(row.fromDate),
    toDate: dateOnly(row.toDate),
    reason: row.reason,
    createdById: row.createdById,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
