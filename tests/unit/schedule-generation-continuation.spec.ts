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

describe('schedule generation continues from the last lesson (C4)', () => {
  type PreviewResult = {
    mode: string;
    slots: Array<{ date: string; lessonId: string }>;
    unscheduledLessons: Array<{ id: string }>;
  };
  type PlanSetup = {
    preview: (fromDate: string, toDate: string) => Promise<PreviewResult>;
    db: { classSession: { findFirst: jest.Mock } };
  };

  // Term 2030-01-07..2030-01-20, Mon/Wed/Fri: slots 07, 09, 11, 14, 16, 18.
  function planSetup(options: {
    last?: { date: string; lessonId: string; sequence: number } | null;
    lessonCount?: number;
    term?: { fromDate: string; toDate: string };
  }): PlanSetup {
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
      status: 'APPROVED',
      fromDate: new Date(`${options.term?.fromDate ?? '2030-01-07'}T00:00:00Z`),
      toDate: new Date(`${options.term?.toDate ?? '2030-01-20'}T00:00:00Z`),
      lessons,
    };
    const classroom = {
      id: 'class-1',
      programId: 'program-1',
      teacherId: 'teacher-1',
      teacher: { role: 'TEACHER', status: 'ACTIVE' },
      program: { id: 'program-1', isActive: true, sessionsPerWeek: 3 },
      weeklySchedules: [1, 3, 5].map((weekday) => ({
        weekday,
        startTime: '18:00',
        endTime: '20:00',
      })),
    };
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
        findFirst: jest.fn().mockResolvedValue(last),
      },
      schedulePreview: {
        create: jest.fn().mockResolvedValue({ id: 'preview-1', expiresAt: new Date() }),
      },
    };
    const service = new CurriculumSchedulingService(db as never, {} as never);
    const preview = (fromDate: string, toDate: string): Promise<PreviewResult> =>
      service.preview(manager, 'class-1', {
        curriculumUnitId: 'unit-1',
        fromDate,
        toDate,
      }) as Promise<PreviewResult>;
    return { preview, db };
  }

  // Legacy data: sessions cancelled before 19/11/2026 (cancel with shift / cancel and drop).
  it('after a shift, the next range starts with the pushed lesson: none lost, none repeated', async () => {
    // Week 1: 07 cancelled with shift, 09 = L1, 11 = L2; L3 was pushed out.
    const { preview, db } = planSetup({
      last: { date: '2030-01-11', lessonId: 'L2', sequence: 2 },
    });
    const result = await preview('2030-01-14', '2030-01-20');
    expect(result.mode).toBe('CONTINUE');
    expect(result.slots.map((slot) => slot.lessonId)).toEqual(['L3', 'L4', 'L5']);
    // Six lessons, five slots after the cancellation: the term cannot take L6.
    expect(result.unscheduledLessons.map((row) => row.id)).toEqual(['L6']);
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

  it('a class opened mid-term teaches the same lesson as the classes that started on time', async () => {
    const result = await planSetup({}).preview('2030-01-14', '2030-01-20');
    expect(result.mode).toBe('TERM_POSITION');
    expect(result.slots.map((slot) => [slot.date, slot.lessonId])).toEqual([
      ['2030-01-14', 'L4'],
      ['2030-01-16', 'L5'],
      ['2030-01-18', 'L6'],
    ]);
  });

  it('skips the Tết break when counting positions from the start of the term', async () => {
    // Tết 2030: break 26/01 (23 tháng Chạp) – 08/02 (mùng 7); Mon/Wed/Fri slots inside it are gone.
    const term = { fromDate: '2030-01-21', toDate: '2030-02-17' };
    const full = await planSetup({ term }).preview('2030-01-21', '2030-02-17');
    expect(full.slots.map((slot) => [slot.date, slot.lessonId])).toEqual([
      ['2030-01-21', 'L1'],
      ['2030-01-23', 'L2'],
      ['2030-01-25', 'L3'],
      ['2030-02-11', 'L4'],
      ['2030-02-13', 'L5'],
      ['2030-02-15', 'L6'],
    ]);
    const midTerm = await planSetup({ term }).preview('2030-02-11', '2030-02-17');
    expect(midTerm.slots.map((slot) => [slot.date, slot.lessonId])).toEqual([
      ['2030-02-11', 'L4'],
      ['2030-02-13', 'L5'],
      ['2030-02-15', 'L6'],
    ]);
  });

  it('generation skips the Tết break and the next lesson lands after Tết', async () => {
    // Tết 2027: break 30/01 – 12/02.
    const result = await planSetup({
      lessonCount: 9,
      term: { fromDate: '2027-01-18', toDate: '2027-02-19' },
    }).preview('2027-01-18', '2027-02-19');
    expect(result.slots.map((slot) => [slot.date, slot.lessonId])).toEqual([
      ['2027-01-18', 'L1'],
      ['2027-01-20', 'L2'],
      ['2027-01-22', 'L3'],
      ['2027-01-25', 'L4'],
      ['2027-01-27', 'L5'],
      ['2027-01-29', 'L6'],
      ['2027-02-15', 'L7'],
      ['2027-02-17', 'L8'],
      ['2027-02-19', 'L9'],
    ]);
  });

  it('cancel-and-drop does not repeat the dropped lesson, except when it was the last one', async () => {
    // 09 (L2) dropped, last kept session is 11 with L3: continue with L4.
    const middle = await planSetup({
      last: { date: '2030-01-11', lessonId: 'L3', sequence: 3 },
    }).preview('2030-01-14', '2030-01-14');
    expect(middle.slots.map((slot) => slot.lessonId)).toEqual(['L4']);
    // 11 (L3) dropped and it was the last session: L3 comes back in the next range.
    const lastDropped = await planSetup({
      last: { date: '2030-01-09', lessonId: 'L2', sequence: 2 },
    }).preview('2030-01-14', '2030-01-14');
    expect(lastDropped.slots.map((slot) => slot.lessonId)).toEqual(['L3']);
  });

  it('refuses a range that starts before sessions this class already has', async () => {
    const error = await rejection(
      planSetup({ last: { date: '2030-01-16', lessonId: 'L5', sequence: 5 } }).preview(
        '2030-01-14',
        '2030-01-20',
      ),
    );
    expect(error).toMatchObject({ code: 'SESSIONS_AFTER_RANGE_EXIST', statusCode: 409 });
    expect(error.details).toEqual({ lastScheduledDate: '2030-01-16' });
  });

  it('fails only when the requested range itself runs out of lessons', async () => {
    // Three lessons, six slots in the term: the first week still works.
    const short = planSetup({ lessonCount: 3 });
    expect((await short.preview('2030-01-07', '2030-01-11')).slots).toHaveLength(3);
    expect(await rejection(short.preview('2030-01-07', '2030-01-14'))).toMatchObject({
      code: 'INSUFFICIENT_LESSONS',
    });
    const done = planSetup({ last: { date: '2030-01-11', lessonId: 'L6', sequence: 6 } });
    expect(await rejection(done.preview('2030-01-14', '2030-01-14'))).toMatchObject({
      code: 'INSUFFICIENT_LESSONS',
    });
  });
});

describe('generate reads the anchor lesson with a lock', () => {
  type GenerateSetup = {
    service: CurriculumSchedulingService;
    db: { $queryRaw: jest.Mock; classSession: Mocked; scheduleGeneration: Mocked };
    lockedSql: () => string[];
  };

  // Same term as above; the class already taught up to L2 on 2030-01-09 (locked read).
  function generateSetup(locked: { date: string; lessonId: string } | null): GenerateSetup {
    const lessons = [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `L${n}`,
      title: `Bài ${n}`,
      kind: 'LESSON',
      sequence: n,
      status: 'APPROVED',
    }));
    const unit = {
      id: 'unit-1',
      programId: 'program-1',
      status: 'APPROVED',
      fromDate: new Date('2030-01-07T00:00:00Z'),
      toDate: new Date('2030-01-20T00:00:00Z'),
      lessons,
    };
    const classroom = {
      id: 'class-1',
      name: 'Toán 8A',
      programId: 'program-1',
      teacherId: 'teacher-1',
      pendingTeacherId: null,
      pendingTeacherFrom: null,
      roomId: null,
      teacher: { role: 'TEACHER', status: 'ACTIVE' },
      program: { id: 'program-1', isActive: true, sessionsPerWeek: 3 },
      weeklySchedules: [1, 3, 5].map((weekday) => ({
        weekday,
        startTime: '18:00',
        endTime: '20:00',
      })),
    };
    const $queryRaw = jest.fn((strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join('?').includes('LIMIT 1 FOR UPDATE') && locked
          ? [{ startsAt: at(locked.date), lessonId: locked.lessonId }]
          : [],
      ),
    );
    const db = {
      $queryRaw,
      $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
        work(db as unknown),
      ),
      curriculumUnit: { findUnique: jest.fn().mockResolvedValue(unit) },
      class: { findUnique: jest.fn().mockResolvedValue(classroom) },
      classSession: {
        // A plain read may see an older snapshot: generate must not use it.
        findFirst: jest.fn().mockResolvedValue({
          startsAt: at('2030-01-11'),
          lesson: { id: 'L3', sequence: 3 },
        }),
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      scheduleGeneration: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'generation-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'generation-1', sessions: [] }),
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

  const range = { curriculumUnitId: 'unit-1', fromDate: '2030-01-14', toDate: '2030-01-20' };

  it('continues from the lesson seen by the locking read, not the plain snapshot', async () => {
    const { service, db, lockedSql } = generateSetup({ date: '2030-01-09', lessonId: 'L2' });
    await service.generate(manager, 'class-1', range, 'gen-1');
    expect(
      lockedSql().some((sql) => sql.includes('ORDER BY startsAt DESC, id DESC LIMIT 1 FOR UPDATE')),
    ).toBe(true);
    expect(db.classSession.findFirst).not.toHaveBeenCalled();
    const created = call(db.classSession.createMany)[0] as { data: Array<{ lessonId: string }> };
    expect(created.data.map((row) => row.lessonId)).toEqual(['L3', 'L4', 'L5']);
  });

  it('checks sessions after the range start on the locked row', async () => {
    const { service, db } = generateSetup({ date: '2030-01-16', lessonId: 'L5' });
    const error = await rejection(service.generate(manager, 'class-1', range, 'gen-1'));
    expect(error).toMatchObject({ code: 'SESSIONS_AFTER_RANGE_EXIST', statusCode: 409 });
    expect(error.details).toEqual({ lastScheduledDate: '2030-01-16' });
    expect(db.classSession.createMany).not.toHaveBeenCalled();
  });

  it('starts from the term position when the locked read finds no session', async () => {
    const { service, db } = generateSetup(null);
    await service.generate(manager, 'class-1', range, 'gen-1');
    const created = call(db.classSession.createMany)[0] as { data: Array<{ lessonId: string }> };
    expect(created.data.map((row) => row.lessonId)).toEqual(['L4', 'L5', 'L6']);
  });
});
