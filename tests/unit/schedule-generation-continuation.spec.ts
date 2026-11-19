import { AppError } from '../../src/common/errors/app.error';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import { CurriculumSchedulingController } from '../../src/modules/curriculum-scheduling/curriculum-scheduling.controller';
import { CurriculumSchedulingService } from '../../src/modules/curriculum-scheduling/curriculum-scheduling.service';

const manager = { id: 'manager-1', role: 'MANAGER' } as AuthenticatedUser;

type Mocked = Record<string, jest.Mock>;

/** 18:00 in Vietnam on a local date. */
function at(date: string): Date {
  return new Date(`${date}T11:00:00.000Z`);
}

/** Arguments of one call of a mock; a negative index counts from the last call. */
function call(mock: jest.Mock, index = 0): unknown[] {
  return (mock.mock.calls as unknown[][]).at(index) ?? [];
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error('expected a rejection');
}

describe('removed session cancel and center closures (19/11/2026)', () => {
  it('the controller exposes no cancel or closure handlers', () => {
    for (const name of [
      'cancelSession',
      'cancelPreview',
      'bulkCancelPreview',
      'bulkCancel',
      'centerClosures',
      'createCenterClosure',
      'updateCenterClosure',
      'deleteCenterClosure',
    ])
      expect(CurriculumSchedulingController.prototype).not.toHaveProperty(name);
  });
});

type UnitOptions = {
  lessonCount?: number;
  weekdays?: number[];
  term?: { fromDate: string; toDate: string };
  status?: 'APPROVED' | 'ARCHIVED';
};

// Unit period 2030-01-07..2030-12-31, Mon/Wed/Fri 18:00, six lessons by default.
function unitAndClass(options: UnitOptions): { unit: unknown; classroom: unknown } {
  const lessons = Array.from({ length: options.lessonCount ?? 6 }, (_, index) => ({
    id: `L${index + 1}`,
    title: `Bài ${index + 1}`,
    kind: 'LESSON',
    sequence: index + 1,
    status: 'APPROVED',
  }));
  const unit = {
    id: 'unit-1',
    programId: 'program-1',
    status: options.status ?? 'APPROVED',
    archiveReason: options.status === 'ARCHIVED' ? 'SUPERSEDED' : null,
    fromDate: new Date(`${options.term?.fromDate ?? '2030-01-07'}T00:00:00Z`),
    toDate: new Date(`${options.term?.toDate ?? '2030-12-31'}T00:00:00Z`),
    lessons,
  };
  const weekdays = options.weekdays ?? [1, 3, 5];
  const classroom = {
    id: 'class-1',
    name: 'Toán 8A',
    programId: 'program-1',
    teacherId: 'teacher-1',
    pendingTeacherId: null,
    pendingTeacherFrom: null,
    roomId: null,
    teacher: { role: 'TEACHER', status: 'ACTIVE' },
    program: { id: 'program-1', isActive: true, sessionsPerWeek: weekdays.length },
    weeklySchedules: weekdays.map((weekday) => ({
      weekday,
      startTime: '18:00',
      endTime: '20:00',
    })),
  };
  return { unit, classroom };
}

describe('schedule runs from the start date to the last lesson (D1)', () => {
  type PreviewResult = {
    mode: string;
    endDate: string;
    toDate: string;
    lessonCount: number;
    unscheduledLessons: unknown[];
    slots: Array<{ date: string; lessonId: string }>;
  };
  type PlanSetup = {
    preview: (fromDate: string) => Promise<PreviewResult>;
    db: { classSession: { findFirst: jest.Mock }; schedulePreview: { create: jest.Mock } };
  };

  function planSetup(
    options: UnitOptions & {
      last?: { date: string; lessonId: string; sequence: number } | null;
      other?: { lesson: { unit: { id: string; title: string } } } | null;
    },
  ): PlanSetup {
    const { unit, classroom } = unitAndClass(options);
    const last = options.last
      ? {
          startsAt: at(options.last.date),
          lesson: { id: options.last.lessonId, sequence: options.last.sequence },
        }
      : null;
    const db = {
      curriculumUnit: { findUnique: jest.fn().mockResolvedValue(unit) },
      class: { findUnique: jest.fn().mockResolvedValue(classroom) },
      classSession: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn((args: { where: { lesson: { unitId: unknown } } }) =>
          Promise.resolve(
            typeof args.where.lesson.unitId === 'object' ? (options.other ?? null) : last,
          ),
        ),
      },
      schedulePreview: {
        create: jest.fn().mockResolvedValue({ id: 'preview-1', expiresAt: new Date() }),
      },
    };
    const service = new CurriculumSchedulingService(db as never, {} as never);
    const preview = (fromDate: string): Promise<PreviewResult> =>
      service.preview(manager, 'class-1', {
        curriculumUnitId: 'unit-1',
        fromDate,
      }) as Promise<PreviewResult>;
    return { preview, db };
  }

  const pairs = (result: PreviewResult): string[][] =>
    result.slots.map((slot) => [slot.date, slot.lessonId]);

  it('a new class starts at lesson 1 even when it opens mid-term', async () => {
    const { preview, db } = planSetup({});
    const result = await preview('2030-01-14');
    expect(result.mode).toBe('FIRST_LESSON');
    expect(pairs(result)).toEqual([
      ['2030-01-14', 'L1'],
      ['2030-01-16', 'L2'],
      ['2030-01-18', 'L3'],
      ['2030-01-21', 'L4'],
      ['2030-01-23', 'L5'],
      ['2030-01-25', 'L6'],
    ]);
    expect(result).toMatchObject({
      endDate: '2030-01-25',
      toDate: '2030-01-25',
      lessonCount: 6,
      unscheduledLessons: [],
    });
    expect(db.schedulePreview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ toDate: new Date('2030-01-25T00:00:00Z') }),
    });
  });

  it('a class that already taught lessons continues after the last one', async () => {
    const { preview, db } = planSetup({
      last: { date: '2030-01-11', lessonId: 'L2', sequence: 2 },
    });
    const result = await preview('2030-01-14');
    expect(result.mode).toBe('CONTINUE');
    expect(pairs(result)).toEqual([
      ['2030-01-14', 'L3'],
      ['2030-01-16', 'L4'],
      ['2030-01-18', 'L5'],
      ['2030-01-21', 'L6'],
    ]);
    expect(result.lessonCount).toBe(4);
    expect(db.classSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          classId: 'class-1',
          status: { not: 'CANCELLED' },
          lesson: { unitId: 'unit-1', kind: 'LESSON' },
        },
      }),
    );
  });

  it('skips the Tết break and the next lesson lands after Tết', async () => {
    // Tết 2030: break 26/01 (23 tháng Chạp) – 08/02 (mùng 7).
    const result = await planSetup({}).preview('2030-01-21');
    expect(pairs(result)).toEqual([
      ['2030-01-21', 'L1'],
      ['2030-01-23', 'L2'],
      ['2030-01-25', 'L3'],
      ['2030-02-11', 'L4'],
      ['2030-02-13', 'L5'],
      ['2030-02-15', 'L6'],
    ]);
  });

  it('ignores the stored period of the curriculum: any start date runs to the last lesson', async () => {
    const term = { fromDate: '2030-01-07', toDate: '2030-01-10' };
    const long = await planSetup({ term }).preview('2030-01-07');
    expect(long.lessonCount).toBe(6);
    expect(long.endDate).toBe('2030-01-18');
    for (const fromDate of ['2030-01-04', '2030-01-11'])
      expect((await planSetup({ term }).preview(fromDate)).mode).toBe('FIRST_LESSON');
  });

  it('a replaced version only continues classes that already teach it (Đợt F)', async () => {
    const status = 'ARCHIVED' as const;
    expect(await rejection(planSetup({ status }).preview('2030-01-14'))).toMatchObject({
      code: 'UNIT_NOT_APPROVED',
    });
    const last = { date: '2030-01-11', lessonId: 'L2', sequence: 2 };
    expect((await planSetup({ status, last }).preview('2030-01-14')).mode).toBe('CONTINUE');
  });

  it('refuses to start before sessions this class already has', async () => {
    const error = await rejection(
      planSetup({ last: { date: '2030-01-16', lessonId: 'L5', sequence: 5 } }).preview(
        '2030-01-14',
      ),
    );
    expect(error).toMatchObject({ code: 'SESSIONS_AFTER_RANGE_EXIST', statusCode: 409 });
    expect(error.details).toEqual({ lastScheduledDate: '2030-01-16' });
  });

  it('a class with sessions of another curriculum is locked to it (CLASS_CURRICULUM_LOCKED)', async () => {
    const other = { lesson: { unit: { id: 'unit-0', title: 'Giáo trình cũ' } } };
    const error = await rejection(planSetup({ other }).preview('2030-01-14'));
    expect(error).toMatchObject({ code: 'CLASS_CURRICULUM_LOCKED', statusCode: 409 });
    expect(error.details).toEqual({ currentUnitId: 'unit-0', currentUnitTitle: 'Giáo trình cũ' });
    // Continuing the same unit is unaffected, and so is a class with no sessions.
    const same = planSetup({ last: { date: '2030-01-11', lessonId: 'L2', sequence: 2 } });
    expect((await same.preview('2030-01-14')).mode).toBe('CONTINUE');
    expect((await planSetup({}).preview('2030-01-14')).mode).toBe('FIRST_LESSON');
  });

  it('a second run on a finished class is CURRICULUM_COMPLETED', async () => {
    const done = planSetup({ last: { date: '2030-01-18', lessonId: 'L6', sequence: 6 } });
    expect(await rejection(done.preview('2030-01-21'))).toMatchObject({
      code: 'CURRICULUM_COMPLETED',
      statusCode: 409,
    });
  });

  it('fails with SCHEDULE_TOO_LONG when the lessons do not fit in 24 months', async () => {
    // One slot a week: about 104 slots in 24 months.
    const error = await rejection(
      planSetup({ lessonCount: 120, weekdays: [1] }).preview('2030-01-07'),
    );
    expect(error).toMatchObject({ code: 'SCHEDULE_TOO_LONG' });
    const fits = await planSetup({ lessonCount: 100, weekdays: [1] }).preview('2030-01-07');
    expect(fits.lessonCount).toBe(100);
  });

  it('a span that crosses two Tết breaks skips both', async () => {
    // Tết 2030: 26/01–08/02; Tết 2031: 16/01–29/01 (23 tháng Chạp to mùng 7).
    const result = await planSetup({
      lessonCount: 130,
      weekdays: [1, 3],
      term: { fromDate: '2030-01-07', toDate: '2030-01-31' },
    }).preview('2030-01-07');
    const inBreak = (from: string, to: string): boolean =>
      result.slots.some((slot) => slot.date >= from && slot.date <= to);
    expect(result.slots.some((slot) => slot.date > '2031-02-01')).toBe(true);
    expect(inBreak('2030-01-26', '2030-02-08')).toBe(false);
    expect(inBreak('2031-01-16', '2031-01-29')).toBe(false);
    expect(result.slots.some((slot) => slot.date === '2030-02-11')).toBe(true);
    expect(result.slots.some((slot) => slot.date === '2031-02-03')).toBe(true);
  });

  it('a class that already taught this curriculum may continue after the unit period ended', async () => {
    const term = { fromDate: '2030-01-07', toDate: '2030-01-10' };
    const result = await planSetup({
      term,
      last: { date: '2030-01-09', lessonId: 'L2', sequence: 2 },
    }).preview('2030-01-14');
    expect(result.mode).toBe('CONTINUE');
    expect(pairs(result)[0]).toEqual(['2030-01-14', 'L3']);
    expect(result.lessonCount).toBe(4);
  });

  it('24 lessons at 2 a week from 2026-12-07 fill 24 slots, lessons 1..24, around Tết 2027', async () => {
    const result = await planSetup({
      lessonCount: 24,
      weekdays: [1, 4],
      term: { fromDate: '2026-12-01', toDate: '2027-12-31' },
    }).preview('2026-12-07');
    expect(result.slots).toHaveLength(24);
    expect(result.slots.map((slot) => slot.lessonId)).toEqual(
      Array.from({ length: 24 }, (_, index) => `L${index + 1}`),
    );
    expect(result.slots[0].date).toBe('2026-12-07');
    // Tết 2027: no session from 30/01 to 12/02.
    expect(
      result.slots.some((slot) => slot.date >= '2027-01-30' && slot.date <= '2027-02-12'),
    ).toBe(false);
    expect(result.endDate).toBe(result.slots[23].date);
    expect(result.lessonCount).toBe(24);
  });
});

describe('generate reads the anchor lesson with a lock', () => {
  type GenerateSetup = {
    service: CurriculumSchedulingService;
    db: {
      $queryRaw: jest.Mock;
      classSession: Mocked;
      scheduleGeneration: Mocked;
      curriculumUnit: Mocked;
      schedulePreview: Mocked;
    };
    lockedSql: () => string[];
  };

  // The class already taught up to L2 on 2030-01-09 (locked read).
  function generateSetup(
    locked: { date: string; lessonId: string } | null,
    otherUnit = false,
  ): GenerateSetup {
    const { unit, classroom } = unitAndClass({});
    const $queryRaw = jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('unitId <>')) return Promise.resolve(otherUnit ? [{ lessonId: 'X1' }] : []);
      return Promise.resolve(
        sql.includes('LIMIT 1 FOR UPDATE') && locked
          ? [{ startsAt: at(locked.date), lessonId: locked.lessonId }]
          : [],
      );
    });
    const db = {
      $queryRaw,
      $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
        work(db as unknown),
      ),
      curriculumUnit: { findUnique: jest.fn().mockResolvedValue(unit) },
      lesson: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ unit: { id: 'unit-0', title: 'Giáo trình cũ' } }),
      },
      class: { findUnique: jest.fn().mockResolvedValue(classroom) },
      classSession: {
        // A plain read may see an older snapshot: generate must not use it.
        findFirst: jest.fn((args: { where: { lesson: { unitId: unknown } } }) =>
          Promise.resolve(
            typeof args.where.lesson.unitId === 'object'
              ? null
              : { startsAt: at('2030-01-11'), lesson: { id: 'L3', sequence: 3 } },
          ),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      scheduleGeneration: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'generation-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'generation-1', sessions: [] }),
      },
      schedulePreview: {
        create: jest.fn().mockResolvedValue({ id: 'preview-1', expiresAt: new Date() }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const notifications = {
      send: jest.fn().mockResolvedValue(undefined),
      recipients: { sessions: jest.fn().mockResolvedValue([]) },
    };
    const service = new CurriculumSchedulingService(db as never, notifications as never);
    return {
      service,
      db,
      lockedSql: () =>
        ($queryRaw.mock.calls as unknown as Array<[TemplateStringsArray]>).map((row) =>
          row[0].join('?'),
        ),
    };
  }

  const range = { curriculumUnitId: 'unit-1', fromDate: '2030-01-14' };

  it('continues from the lesson seen by the locking read, not the plain snapshot', async () => {
    const { service, db, lockedSql } = generateSetup({ date: '2030-01-09', lessonId: 'L2' });
    await service.generate(manager, 'class-1', range, 'gen-1');
    expect(
      lockedSql().some((sql) => sql.includes('ORDER BY startsAt DESC, id DESC LIMIT 1 FOR UPDATE')),
    ).toBe(true);
    expect(db.classSession.findFirst).not.toHaveBeenCalled();
    const created = call(db.classSession.createMany)[0] as { data: Array<{ lessonId: string }> };
    expect(created.data.map((row) => row.lessonId)).toEqual(['L3', 'L4', 'L5', 'L6']);
    // The generation records the real end date.
    expect(call(db.scheduleGeneration.create)[0]).toMatchObject({
      data: { toDate: new Date('2030-01-21T00:00:00Z') },
    });
  });

  it('accepts its own preview and rejects it once the curriculum changed', async () => {
    const { service, db } = generateSetup(null);
    // No class sessions at all: the plain and the locked anchor agree.
    db.classSession.findFirst.mockResolvedValue(null);
    await service.preview(manager, 'class-1', range);
    const saved = (call(db.schedulePreview.create)[0] as { data: Record<string, unknown> }).data;
    db.schedulePreview.findUnique.mockResolvedValue({
      ...saved,
      id: 'preview-1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await service.generate(manager, 'class-1', { ...range, previewId: 'preview-1' }, 'gen-1');
    expect(db.classSession.createMany).toHaveBeenCalledTimes(1);

    // A lesson is added after the preview: the saved preview no longer matches.
    const unit = (await db.curriculumUnit.findUnique()) as { lessons: Array<{ id: string }> };
    unit.lessons.push({
      id: 'L7',
      title: 'Bài 7',
      kind: 'LESSON',
      sequence: 7,
      status: 'APPROVED',
    } as never);
    const error = await rejection(
      service.generate(manager, 'class-1', { ...range, previewId: 'preview-1' }, 'gen-2'),
    );
    expect(error).toMatchObject({ code: 'PREVIEW_STALE' });
    expect(db.classSession.createMany).toHaveBeenCalledTimes(1);
  });

  it('checks sessions after the range start on the locked row', async () => {
    const { service, db } = generateSetup({ date: '2030-01-16', lessonId: 'L5' });
    const error = await rejection(service.generate(manager, 'class-1', range, 'gen-1'));
    expect(error).toMatchObject({ code: 'SESSIONS_AFTER_RANGE_EXIST', statusCode: 409 });
    expect(error.details).toEqual({ lastScheduledDate: '2030-01-16' });
    expect(db.classSession.createMany).not.toHaveBeenCalled();
  });

  it('generate refuses a class locked to another curriculum', async () => {
    const { service, db, lockedSql } = generateSetup(null, true);
    const error = await rejection(service.generate(manager, 'class-1', range, 'gen-1'));
    expect(error).toMatchObject({ code: 'CLASS_CURRICULUM_LOCKED', statusCode: 409 });
    expect(error.details).toEqual({ currentUnitId: 'unit-0', currentUnitTitle: 'Giáo trình cũ' });
    expect(lockedSql().some((sql) => sql.includes('unitId <>') && sql.includes('FOR UPDATE'))).toBe(
      true,
    );
    expect(db.classSession.createMany).not.toHaveBeenCalled();
  });

  it('starts at lesson 1 when the locked read finds no session', async () => {
    const { service, db } = generateSetup(null);
    await service.generate(manager, 'class-1', range, 'gen-1');
    const created = call(db.classSession.createMany)[0] as { data: Array<{ lessonId: string }> };
    expect(created.data.map((row) => row.lessonId)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
  });
});

describe('session list filter keeps its contract', () => {
  it('still accepts status=CANCELLED so old clients can list legacy cancelled sessions', async () => {
    const { plainToInstance } = await import('class-transformer');
    const { validate } = await import('class-validator');
    const { SessionQueryDto } =
      await import('../../src/modules/curriculum-scheduling/curriculum-scheduling.dto');
    const errors = await validate(plainToInstance(SessionQueryDto, { status: 'CANCELLED' }));
    expect(errors).toEqual([]);
  });
});

describe('schedule without a named curriculum (Đợt F)', () => {
  type Resolver = { scheduleUnitId: (db: unknown, classId: string) => Promise<string> };
  function resolver(lastUnitId: string | null, currentId: string | null) {
    const db = {
      classSession: {
        findFirst: jest
          .fn()
          .mockResolvedValue(lastUnitId ? { lesson: { unitId: lastUnitId } } : null),
      },
      class: { findUnique: jest.fn().mockResolvedValue({ programId: 'program-1' }) },
      curriculumUnit: {
        findFirst: jest.fn().mockResolvedValue(currentId ? { id: currentId } : null),
      },
    };
    const service = new CurriculumSchedulingService(db as never, {} as never);
    return { db, resolve: () => (service as unknown as Resolver).scheduleUnitId(db, 'class-1') };
  }

  it('keeps the version the class already teaches', async () => {
    const { db, resolve } = resolver('unit-old', 'unit-new');
    await expect(resolve()).resolves.toBe('unit-old');
    expect(db.curriculumUnit.findFirst).not.toHaveBeenCalled();
  });

  it('starts a new class on the approved version of its program', async () => {
    const { db, resolve } = resolver(null, 'unit-new');
    await expect(resolve()).resolves.toBe('unit-new');
    expect(db.curriculumUnit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { programId: 'program-1', status: 'APPROVED' } }),
    );
  });

  it('refuses when the program has no approved curriculum', async () => {
    await expect(resolver(null, null).resolve()).rejects.toMatchObject({
      code: 'UNIT_NOT_APPROVED',
    });
  });
});
