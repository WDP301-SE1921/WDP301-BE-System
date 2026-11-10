import 'reflect-metadata';
import { Prisma, type CenterClosure } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AppError } from '../../src/common/errors/app.error';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import {
  CenterClosureService,
  closuresBetween,
} from '../../src/modules/curriculum-scheduling/center-closure.service';
import { CenterClosureQueryDto } from '../../src/modules/curriculum-scheduling/curriculum-scheduling.dto';
import { slotsForRange } from '../../src/modules/curriculum-scheduling/session-lesson-plan';

const manager = { id: 'manager-1', role: 'MANAGER' } as AuthenticatedUser;

type Mocked = Record<string, jest.Mock>;
type ClosureDb = {
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
  centerClosure: Mocked;
  classSession: Mocked;
  auditLog: Mocked;
};

/** Arguments of one call of a mock; a negative index counts from the last call. */
function call(mock: jest.Mock, index = 0): unknown[] {
  return (mock.mock.calls as unknown[][]).at(index) ?? [];
}

function auditAction(mock: jest.Mock, index: number): string {
  return (call(mock, index)[0] as { data: { action: string } }).data.action;
}

function row(id: string, fromDate: string, toDate: string, revision = 1): CenterClosure {
  return {
    id,
    fromDate: new Date(`${fromDate}T00:00:00.000Z`),
    toDate: new Date(`${toDate}T00:00:00.000Z`),
    reason: 'Tết Nguyên đán',
    createdById: 'manager-1',
    revision,
    createdAt: new Date('2026-11-10T00:00:00.000Z'),
    updatedAt: new Date('2026-11-10T00:00:00.000Z'),
  };
}

function setup(existing: CenterClosure[] = []): { service: CenterClosureService; db: ClosureDb } {
  const db: ClosureDb = {
    $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
      work(db as unknown),
    ),
    $queryRaw: jest.fn().mockResolvedValue([]),
    centerClosure: {
      findMany: jest.fn().mockResolvedValue(existing),
      count: jest.fn().mockResolvedValue(existing.length),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(existing.find((item) => item.id === where.id) ?? null),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...row('new', '2030-01-01', '2030-01-01'), ...data }),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...existing[0], ...data, revision: existing[0].revision + 1 }),
      ),
      delete: jest.fn().mockResolvedValue({}),
    },
    classSession: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 's1',
          classId: 'class-1',
          startsAt: new Date('2030-02-04T11:00:00.000Z'),
          endsAt: new Date('2030-02-04T13:00:00.000Z'),
          revision: 3,
          class: { name: 'Toán 8A' },
          lesson: { id: 'L4', title: 'Bài 4' },
        },
      ]),
      count: jest.fn().mockResolvedValue(1),
      updateMany: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  return { service: new CenterClosureService(db as never), db };
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error('expected a rejection');
}

describe('center closures in the weekly calendar', () => {
  const schedules = [1, 3, 5].map((weekday) => ({ weekday, startTime: '18:00', endTime: '20:00' }));

  it('skips every closed local date and keeps the other slots', () => {
    const slots = slotsForRange(schedules, '2030-02-04', '2030-02-15', [
      { fromDate: '2030-02-06', toDate: '2030-02-11' },
    ]);
    expect(slots.map((slot) => slot.date)).toEqual(['2030-02-04', '2030-02-13', '2030-02-15']);
  });

  it('keeps the old calendar when no closures are passed', () => {
    expect(slotsForRange(schedules, '2030-02-04', '2030-02-08')).toHaveLength(3);
  });

  it('reads the closures overlapping a range as local dates', async () => {
    const findMany = jest.fn().mockResolvedValue([row('c1', '2030-02-06', '2030-02-11')]);
    expect(
      await closuresBetween({ centerClosure: { findMany } } as never, '2030-02-01', '2030-02-28'),
    ).toEqual([{ fromDate: '2030-02-06', toDate: '2030-02-11' }]);
    expect((call(findMany)[0] as { where: unknown }).where).toEqual({
      fromDate: { lte: new Date('2030-02-28T00:00:00.000Z') },
      toDate: { gte: new Date('2030-02-01T00:00:00.000Z') },
    });
  });
});

describe('center closure routes', () => {
  it('lets every staff role list closures, with paging metadata on request', async () => {
    const { service, db } = setup([row('c1', '2030-02-06', '2030-02-11')]);
    for (const role of ['MANAGER', 'STAFF', 'TEACHER', 'CURRICULUM_DESIGNER', 'ADMIN'] as const) {
      const result = (await service.list({ id: 'u', role } as AuthenticatedUser, {
        page: 1,
        limit: 20,
        paginated: true,
        fromDate: '2030-02-01',
      })) as { items: Array<{ fromDate: string }>; total: number };
      expect(result.items[0].fromDate).toBe('2030-02-06');
      expect(result.total).toBe(1);
    }
    expect((call(db.centerClosure.findMany)[0] as { where: unknown }).where).toEqual({
      toDate: { gte: new Date('2030-02-01T00:00:00.000Z') },
    });
    expect(
      await rejection(
        service.list({ id: 'p', role: 'PARENT' } as AuthenticatedUser, { page: 1, limit: 20 }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });

  it('creates a closure, audits it and lists the scheduled sessions inside without cancelling', async () => {
    const { service, db } = setup();
    const result = (await service.create(manager, {
      fromDate: '2030-02-04',
      toDate: '2030-02-08',
      reason: ' Tết Nguyên đán ',
    })) as Record<string, unknown>;
    expect(result).toMatchObject({
      fromDate: '2030-02-04',
      toDate: '2030-02-08',
      reason: 'Tết Nguyên đán',
      affectedTotal: 1,
      affectedSessions: [
        { id: 's1', classId: 'class-1', revision: 3, className: 'Toán 8A', lesson: { id: 'L4' } },
      ],
    });
    // [fromDate 00:00+07, toDate+1 00:00+07), scheduled sessions only.
    expect((call(db.classSession.findMany)[0] as { where: unknown }).where).toEqual({
      status: 'SCHEDULED',
      startsAt: {
        gte: new Date('2030-02-03T17:00:00.000Z'),
        lt: new Date('2030-02-08T17:00:00.000Z'),
      },
    });
    expect(db.classSession.updateMany).not.toHaveBeenCalled();
    expect(auditAction(db.auditLog.create, 0)).toBe('CENTER_CLOSURE_CREATED');
  });

  it('only lets managers change closures', async () => {
    const { service } = setup([row('c1', '2030-02-06', '2030-02-11')]);
    const staff = { id: 's', role: 'STAFF' } as AuthenticatedUser;
    const input = { fromDate: '2030-02-04', toDate: '2030-02-08', reason: 'Lễ' };
    for (const call of [
      service.create(staff, input),
      service.update(staff, 'c1', { expectedRevision: 1 }),
      service.remove(staff, 'c1'),
    ])
      expect(await rejection(call)).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });

  it('lets the ADMIN change closures like a manager', async () => {
    const { service } = setup();
    const admin = { id: 'admin-1', role: 'ADMIN' } as AuthenticatedUser;
    await expect(
      service.create(admin, { fromDate: '2030-02-04', toDate: '2030-02-08', reason: 'Lễ' }),
    ).resolves.toMatchObject({ fromDate: '2030-02-04', toDate: '2030-02-08' });
  });

  it('rejects reversed, too long and overlapping ranges', async () => {
    const { service, db } = setup();
    expect(
      await rejection(
        service.create(manager, { fromDate: '2030-02-08', toDate: '2030-02-04', reason: 'x' }),
      ),
    ).toMatchObject({ code: 'INVALID_DATE_RANGE', statusCode: 400 });
    expect(
      await rejection(
        service.create(manager, { fromDate: '2030-01-01', toDate: '2030-04-30', reason: 'x' }),
      ),
    ).toMatchObject({ code: 'CLOSURE_TOO_LONG', statusCode: 400 });
    db.$queryRaw.mockResolvedValueOnce([row('c9', '2030-02-01', '2030-02-05')]);
    const overlap = await rejection(
      service.create(manager, { fromDate: '2030-02-04', toDate: '2030-02-08', reason: 'x' }),
    );
    expect(overlap).toMatchObject({ code: 'CENTER_CLOSURE_OVERLAP', statusCode: 409 });
    expect(overlap.details).toMatchObject({ id: 'c9', fromDate: '2030-02-01', revision: 1 });
    expect(db.centerClosure.create).not.toHaveBeenCalled();
  });

  it('checks overlaps with a locking read so two managers cannot both pass', async () => {
    const { service, db } = setup();
    await service.create(manager, { fromDate: '2030-02-04', toDate: '2030-02-08', reason: 'Lễ' });
    const query = call(db.$queryRaw, 0)[0] as Prisma.Sql;
    expect(query.sql).toMatch(/FROM center_closures[\s\S]*FOR UPDATE/);
    expect(query.values).toEqual(['2030-02-08', '2030-02-04']);
    expect(call(db.$transaction, 0)[1]).toEqual({ isolationLevel: 'RepeatableRead' });
  });

  it('retries a deadlock between two concurrent saves, and the retry sees the other closure', async () => {
    const { service, db } = setup();
    const deadlock = new Prisma.PrismaClientKnownRequestError('deadlock', {
      code: 'P2034',
      clientVersion: '6.16.2',
    });
    db.$transaction.mockRejectedValueOnce(deadlock);
    db.$queryRaw.mockResolvedValueOnce([row('c9', '2030-02-01', '2030-02-05')]);
    expect(
      await rejection(
        service.create(manager, { fromDate: '2030-02-04', toDate: '2030-02-08', reason: 'x' }),
      ),
    ).toMatchObject({ code: 'CENTER_CLOSURE_OVERLAP', statusCode: 409 });
    expect(db.$transaction).toHaveBeenCalledTimes(2);

    db.$transaction.mockClear();
    db.$transaction.mockRejectedValue(deadlock);
    expect(
      await rejection(
        service.create(manager, { fromDate: '2030-02-04', toDate: '2030-02-08', reason: 'x' }),
      ),
    ).toBe(deadlock);
    expect(db.$transaction).toHaveBeenCalledTimes(3);
  });

  it('also retries a deadlock raised inside the locking read (P2010 with MySQL 1213)', async () => {
    const { service, db } = setup([row('c1', '2030-02-06', '2030-02-11')]);
    const rawDeadlock = new Prisma.PrismaClientKnownRequestError('raw query failed', {
      code: 'P2010',
      clientVersion: '6.16.2',
      meta: { code: '1213', message: 'Deadlock found when trying to get lock' },
    });
    db.$transaction.mockRejectedValueOnce(rawDeadlock);
    await expect(
      service.update(manager, 'c1', { toDate: '2030-02-12', expectedRevision: 1 }),
    ).resolves.toMatchObject({ toDate: '2030-02-12' });
    expect(db.$transaction).toHaveBeenCalledTimes(2);

    const otherRawError = new Prisma.PrismaClientKnownRequestError('raw query failed', {
      code: 'P2010',
      clientVersion: '6.16.2',
      meta: { code: '1064', message: 'syntax error' },
    });
    db.$transaction.mockClear();
    db.$transaction.mockRejectedValueOnce(otherRawError);
    expect(await rejection(service.update(manager, 'c1', { expectedRevision: 1 }))).toBe(
      otherRawError,
    );
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('updates with the expected revision and ignores itself in the overlap check', async () => {
    const { service, db } = setup([row('c1', '2030-02-06', '2030-02-11')]);
    expect(await rejection(service.update(manager, 'c1', { expectedRevision: 5 }))).toMatchObject({
      code: 'REVISION_CONFLICT',
      statusCode: 409,
    });
    const result = (await service.update(manager, 'c1', {
      toDate: '2030-02-12',
      expectedRevision: 1,
    })) as Record<string, unknown>;
    expect(result).toMatchObject({ fromDate: '2030-02-06', toDate: '2030-02-12', revision: 2 });
    const query = call(db.$queryRaw, -1)[0] as Prisma.Sql;
    expect(query.sql).toMatch(/AND id <> \?[\s\S]*FOR UPDATE/);
    expect(query.values).toEqual(['2030-02-12', '2030-02-06', 'c1']);
    expect(auditAction(db.auditLog.create, -1)).toBe('CENTER_CLOSURE_UPDATED');
  });

  it('deletes with an audit and returns 404 for an unknown closure', async () => {
    const { service, db } = setup([row('c1', '2030-02-06', '2030-02-11')]);
    expect(await service.remove(manager, 'c1')).toEqual({ id: 'c1', deleted: true });
    expect(auditAction(db.auditLog.create, 0)).toBe('CENTER_CLOSURE_DELETED');
    expect(await rejection(service.remove(manager, 'nope'))).toMatchObject({
      code: 'CENTER_CLOSURE_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('validates the list query dates', async () => {
    const bad = plainToInstance(CenterClosureQueryDto, { fromDate: '2030-2-1' });
    expect((await validate(bad)).map((item) => item.property)).toEqual(['fromDate']);
  });
});
