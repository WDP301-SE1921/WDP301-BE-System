import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DatabaseService } from '../../src/database/orm/database.service';
import {
  archiveSupersededCurricula,
  assertCurriculumSessionDates,
  assertNoCurriculumOverlap,
  publishedCurriculumWhere,
  vietnamDate,
} from '../../src/modules/curriculum-scheduling/curriculum-lifecycle';
import { CurriculumLifecycleWorker } from '../../src/modules/curriculum-scheduling/curriculum-lifecycle.worker';

interface Publication {
  id: string;
  programId: string;
  status: string;
  fromDate: Date;
  toDate: Date;
  approvedAt: Date;
  designerId: string;
  reviewedById: string;
  archiveReason: string | null;
  supersededById: string | null;
}

interface LifecycleFixture {
  units: Publication[];
  db: {
    curriculumUnit: { findMany: jest.Mock; updateMany: jest.Mock };
    auditLog: { create: jest.Mock };
  };
  tx: Prisma.TransactionClient;
}

/** Errors thrown by a synchronous assertion, so matchers stay typed. */
function thrown(work: () => void): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  return undefined;
}

function publication(id: string, from: string, to: string): Publication {
  return {
    id,
    programId: 'program',
    status: 'APPROVED',
    fromDate: new Date(from),
    toDate: new Date(to),
    approvedAt: new Date('2026-09-01'),
    designerId: 'designer',
    reviewedById: 'manager',
    archiveReason: null as string | null,
    supersededById: null as string | null,
  };
}

function lifecycleFixture(
  units: Publication[] = [
    publication('A', '2026-10-01', '2026-10-31'),
    publication('B', '2026-11-01', '2026-11-30'),
  ],
): LifecycleFixture {
  const db = {
    curriculumUnit: {
      findMany: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            units.filter(
              (unit) =>
                unit.status === 'APPROVED' ||
                (unit.status === 'ARCHIVED' && unit.archiveReason === 'SUPERSEDED'),
            ),
          ),
        ),
      updateMany: jest
        .fn()
        .mockImplementation(
          ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const unit = units.find(
              (candidate) => candidate.id === where.id && candidate.status === 'APPROVED',
            );
            if (!unit) return Promise.resolve({ count: 0 });
            Object.assign(unit, data);
            return Promise.resolve({ count: 1 });
          },
        ),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  return { units, db, tx: db as unknown as Prisma.TransactionClient };
}

describe('curriculum publication lifecycle', () => {
  it('switches at the Vietnam date boundary and archives once', async () => {
    const { units, tx, db } = lifecycleFixture();
    await archiveSupersededCurricula(tx, 'program', new Date('2026-10-31T16:59:59.999Z'));
    expect(units.map((unit) => unit.status)).toEqual(['APPROVED', 'APPROVED']);
    await archiveSupersededCurricula(tx, 'program', new Date('2026-10-31T17:00:00Z'));
    expect(units[0]).toMatchObject({
      status: 'ARCHIVED',
      archiveReason: 'SUPERSEDED',
      supersededById: 'B',
    });
    expect(units[1].status).toBe('APPROVED');
    await archiveSupersededCurricula(tx, 'program', new Date('2026-11-01T10:00:00Z'));
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    expect(db.auditLog.create.mock.calls[0] as unknown[]).toMatchObject([
      {
        data: {
          actorUserId: 'manager',
          action: 'CURRICULUM_UNIT_AUTO_ARCHIVED',
          afterData: { triggeredBy: 'SYSTEM', supersededById: 'B' },
        },
      },
    ]);
  });

  it('catches up multiple missed periods, retaining the nearest successor and future publication', async () => {
    const { units, tx } = lifecycleFixture([
      publication('A', '2026-08-01', '2026-08-31'),
      publication('B', '2026-09-01', '2026-09-30'),
      publication('C', '2026-10-01', '2026-10-31'),
      publication('D', '2026-11-01', '2026-11-30'),
    ]);
    await archiveSupersededCurricula(tx, 'program', new Date('2026-10-20T00:00:00Z'));
    expect(units.map((unit) => [unit.id, unit.status, unit.supersededById])).toEqual([
      ['A', 'ARCHIVED', 'B'],
      ['B', 'ARCHIVED', 'C'],
      ['C', 'APPROVED', null],
      ['D', 'APPROVED', null],
    ]);
  });

  it('does not extend an ended publication or archive it during a gap before its successor', async () => {
    const { units, tx, db } = lifecycleFixture([
      publication('A', '2026-09-01', '2026-09-30'),
      publication('B', '2026-11-01', '2026-11-30'),
    ]);
    await archiveSupersededCurricula(tx, 'program', new Date('2026-10-20T00:00:00Z'));
    expect(db.curriculumUnit.updateMany).not.toHaveBeenCalled();
    expect(units[0].toDate).toEqual(new Date('2026-09-30'));
  });

  it('does not use a successor manually archived before its start', async () => {
    const source = publication('A', '2026-10-01', '2026-10-31');
    const cancelled = {
      ...publication('B', '2026-11-01', '2026-11-30'),
      status: 'ARCHIVED',
      archiveReason: 'MANUAL',
    };
    const { tx, db } = lifecycleFixture([source, cancelled]);
    await archiveSupersededCurricula(tx, 'program', new Date('2026-11-02T00:00:00Z'));
    expect(db.curriculumUnit.updateMany).not.toHaveBeenCalled();
  });

  it('keeps auto-archived historical intervals in inclusive overlap checks', async () => {
    const source = publication('old', '2026-10-01', '2026-10-31');
    const db = {
      curriculumUnit: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ ...source, status: 'ARCHIVED', archiveReason: 'SUPERSEDED' }]),
      },
    };
    await expect(
      assertNoCurriculumOverlap(
        db as unknown as Prisma.TransactionClient,
        publication('new', '2026-10-31', '2026-11-30'),
      ),
    ).rejects.toMatchObject({ code: 'CURRICULUM_EFFECTIVE_PERIOD_CONFLICT' });
    expect(db.curriculumUnit.findMany.mock.calls[0] as unknown[]).toMatchObject([
      {
        where: {
          programId: 'program',
          id: { not: 'new' },
          fromDate: { lte: new Date('2026-11-30') },
          toDate: { gte: new Date('2026-10-31') },
          ...publishedCurriculumWhere,
        },
      },
    ]);
  });

  it('uses local midnight boundaries for legacy sessions, including the entire final day', () => {
    const unit = publication('A', '2026-10-01', '2026-10-31');
    expect(vietnamDate(new Date('2026-09-30T17:00:00Z'))).toBe('2026-10-01');
    expect(() =>
      assertCurriculumSessionDates(
        unit,
        new Date('2026-10-31T13:00:00Z'),
        new Date('2026-10-31T17:00:00Z'),
      ),
    ).not.toThrow();
    expect(
      thrown(() =>
        assertCurriculumSessionDates(
          unit,
          new Date('2026-09-30T16:59:59Z'),
          new Date('2026-09-30T18:00:00Z'),
        ),
      ),
    ).toMatchObject({ code: 'RANGE_OUTSIDE_UNIT' });
    expect(
      thrown(() =>
        assertCurriculumSessionDates(
          unit,
          new Date('2026-10-31T16:00:00Z'),
          new Date('2026-10-31T17:00:01Z'),
        ),
      ),
    ).toMatchObject({ code: 'RANGE_OUTSIDE_UNIT' });
  });
});

describe('curriculum lifecycle worker', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('catches up on startup, runs without client requests, and stops its timer', async () => {
    jest.useFakeTimers();
    const worker = new CurriculumLifecycleWorker({} as DatabaseService);
    const tick = jest.spyOn(worker, 'tick').mockResolvedValue();
    await worker.onModuleInit();
    expect(tick).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(2);
    await worker.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('waits for an in-flight startup reconciliation before shutdown', async () => {
    const worker = new CurriculumLifecycleWorker({} as DatabaseService);
    let finish!: () => void;
    jest.spyOn(worker, 'tick').mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const initialization = worker.onModuleInit();
    let stopped = false;
    const shutdown = worker.onModuleDestroy().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish();
    await Promise.all([initialization, shutdown]);
    expect(stopped).toBe(true);
  });

  it('logs failed iterations and retries on the next scheduled run', async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const worker = new CurriculumLifecycleWorker({} as DatabaseService);
    const tick = jest
      .spyOn(worker, 'tick')
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue();
    await worker.onModuleInit();
    expect(warn).toHaveBeenCalledWith('Curriculum lifecycle reconciliation failed');
    await jest.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(2);
    await worker.onModuleDestroy();
  });
});
