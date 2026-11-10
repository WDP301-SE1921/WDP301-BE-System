import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppError } from '../../src/common/errors/app.error';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import { CurriculumSchedulingController } from '../../src/modules/curriculum-scheduling/curriculum-scheduling.controller';
import { CurriculumSchedulingService } from '../../src/modules/curriculum-scheduling/curriculum-scheduling.service';
import {
  SessionBulkCancelDto,
  SessionCancelDto,
} from '../../src/modules/curriculum-scheduling/curriculum-scheduling.dto';
import type { CancelTargetRow } from '../../src/modules/curriculum-scheduling/session-cancellation.repository';
import { SessionCancellationService } from '../../src/modules/curriculum-scheduling/session-cancellation.service';
import { compactLessons } from '../../src/modules/curriculum-scheduling/session-lesson-plan';

const manager = { id: 'manager-1', role: 'MANAGER' } as AuthenticatedUser;
const staff = { id: 'staff-1', role: 'STAFF' } as AuthenticatedUser;

/** 18:00 in Vietnam on a local date. */
function at(date: string): Date {
  return new Date(`${date}T11:00:00.000Z`);
}

type LessonFixture = {
  id: string;
  title: string;
  sequence: number;
  kind: string;
  unitId: string | null;
};
type Mocked = Record<string, jest.Mock>;
type CancelSetup = {
  service: SessionCancellationService;
  repo: Mocked;
  db: Record<string, Mocked>;
  notifications: { session: jest.Mock; send: jest.Mock };
};

/** Arguments of one call of a mock; a negative index counts from the last call. */
function call(mock: jest.Mock, index = 0): unknown[] {
  return (mock.mock.calls as unknown[][]).at(index) ?? [];
}

function lesson(id: string, sequence: number, unitId: string | null = 'unit-1'): LessonFixture {
  return { id, title: `Bài ${id}`, sequence, kind: 'LESSON', unitId };
}

function session(id: string, date: string, lessonId: string, classId = 'class-1'): CancelTargetRow {
  return {
    id,
    classId,
    lessonId,
    teacherId: 'teacher-1',
    startsAt: at(date),
    endsAt: new Date(at(date).getTime() + 2 * 3_600_000),
    status: 'SCHEDULED',
    revision: 1,
  };
}

type Fixture = {
  sessions: CancelTargetRow[];
  lessons: LessonFixture[];
  booked?: string[];
  attended?: string[];
  unitToDate?: string;
};

function setup(fixture: Fixture): CancelSetup {
  const sessions = fixture.sessions;
  const booked = new Set(fixture.booked ?? []);
  const repo = {
    lockClasses: jest.fn().mockResolvedValue(undefined),
    sessions: jest.fn((_tx: unknown, ids: string[]) =>
      Promise.resolve(sessions.filter((row) => ids.includes(row.id))),
    ),
    chain: jest.fn((_tx: unknown, classIds: string[], from: Date) =>
      Promise.resolve(
        sessions
          .filter(
            (row) =>
              classIds.includes(row.classId) && row.status === 'SCHEDULED' && row.startsAt >= from,
          )
          .map(({ id, classId, lessonId, startsAt }) => ({ id, classId, lessonId, startsAt })),
      ),
    ),
    bookedSessionIds: jest.fn((_tx: unknown, ids: string[]) =>
      Promise.resolve(new Set(ids.filter((id) => booked.has(id)))),
    ),
    applyLessons: jest.fn().mockResolvedValue(undefined),
    lastUnitSession: jest.fn().mockResolvedValue(null),
  };
  const db = {
    $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
      work(db as unknown),
    ),
    classSession: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(sessions.find((row) => row.id === where.id) ?? null),
      ),
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(sessions.filter((row) => where.id.in.includes(row.id))),
      ),
      findUniqueOrThrow: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({
          ...sessions.find((row) => row.id === where.id),
          status: 'CANCELLED',
          revision: 2,
        }),
      ),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    sessionParticipant: {
      findMany: jest
        .fn()
        .mockResolvedValue((fixture.attended ?? []).map((sessionId) => ({ sessionId }))),
    },
    leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
    lesson: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(fixture.lessons.filter((row) => where.id.in.includes(row.id))),
      ),
    },
    assignment: { findMany: jest.fn().mockResolvedValue([]) },
    class: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'class-1',
          name: 'Toán 8A',
          weeklySchedules: [1, 3, 5].map((weekday) => ({
            weekday,
            startTime: '18:00',
            endTime: '20:00',
          })),
        },
      ]),
    },
    curriculumUnit: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'unit-1',
          fromDate: new Date('2030-01-07T00:00:00.000Z'),
          toDate: new Date(`${fixture.unitToDate ?? '2030-01-16'}T00:00:00.000Z`),
        },
      ]),
    },
    centerClosure: { findMany: jest.fn().mockResolvedValue([]) },
    sessionMutation: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    sessionBulkCancel: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    auditLog: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const notifications = {
    session: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    recipients: { sessions: jest.fn().mockResolvedValue([]) },
  };
  const service = new SessionCancellationService(db as never, notifications as never, repo);
  return { service, repo, db: db as unknown as Record<string, Mocked>, notifications };
}

// Mon/Wed/Fri lessons 1–5 of unit-1, all in the future.
function standardWeek(): Fixture {
  return {
    sessions: [
      session('s1', '2030-01-07', 'L1'),
      session('s2', '2030-01-09', 'L2'),
      session('s3', '2030-01-11', 'L3'),
      session('s4', '2030-01-14', 'L4'),
      session('s5', '2030-01-16', 'L5'),
    ],
    lessons: [1, 2, 3, 4, 5].map((n) => lesson(`L${n}`, n)),
  };
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error('expected a rejection');
}

describe('compactLessons', () => {
  const chain = [1, 2, 3, 4].map((n) => ({
    id: `s${n}`,
    startsAt: at(`2030-01-0${n}`),
    lessonId: `L${n}`,
  }));

  it('moves every later lesson back one session and pushes the last one out', () => {
    expect(compactLessons(chain, new Set(['s2']))).toEqual({
      changes: [
        { sessionId: 's3', fromLessonId: 'L3', toLessonId: 'L2' },
        { sessionId: 's4', fromLessonId: 'L4', toLessonId: 'L3' },
      ],
      pushedLessonIds: ['L4'],
    });
  });

  it('cancelling consecutive sessions at once equals cancelling them one by one', () => {
    const together = compactLessons(chain, new Set(['s2', 's3']));
    const first = compactLessons(chain, new Set(['s2']));
    const afterFirst = chain
      .filter((row) => row.id !== 's2')
      .map((row) => ({
        ...row,
        lessonId:
          first.changes.find((change) => change.sessionId === row.id)?.toLessonId ?? row.lessonId,
      }));
    const second = compactLessons(afterFirst, new Set(['s3']));
    expect(together.changes).toEqual([{ sessionId: 's4', fromLessonId: 'L4', toLessonId: 'L2' }]);
    expect(together.pushedLessonIds).toEqual(['L3', 'L4']);
    expect(second.changes.map((row) => [row.sessionId, row.toLessonId])).toEqual([['s4', 'L2']]);
    expect([...second.pushedLessonIds, ...first.pushedLessonIds]).toEqual(['L3', 'L4']);
  });

  it('cancelling the last session moves nothing and pushes its own lesson', () => {
    expect(compactLessons(chain, new Set(['s4']))).toEqual({
      changes: [],
      pushedLessonIds: ['L4'],
    });
  });
});

describe('cancel with lesson shift', () => {
  const body = { reason: 'Giáo viên ốm', expectedRevision: 1, shiftLessons: true };

  it('shifts later lessons, returns the pushed lesson and keeps the session fields on top', async () => {
    const { service, repo, db, notifications } = setup(standardWeek());
    const result = (await service.cancelWithShift(manager, 's2', body, 'key-1')) as Record<
      string,
      unknown
    >;
    expect(repo.lockClasses).toHaveBeenCalledWith(db, ['class-1']);
    expect(repo.applyLessons).toHaveBeenCalledWith(db, [
      { sessionId: 's3', lessonId: 'L2' },
      { sessionId: 's4', lessonId: 'L3' },
      { sessionId: 's5', lessonId: 'L4' },
    ]);
    expect(result).toMatchObject({
      id: 's2',
      classId: 'class-1',
      status: 'CANCELLED',
      revision: 2,
      pushedLesson: { id: 'L5', title: 'Bài L5', sequence: 5 },
      pushedLessonFits: false,
    });
    expect((result.shiftedSessions as unknown[]).length).toBe(3);
    const stored = call(db.sessionMutation.create)[0] as { data: { response: unknown } };
    expect(stored.data.response).toEqual(result);
    expect(notifications.session).toHaveBeenCalledTimes(1);
    expect(call(notifications.session)[4]).toContain('lùi một buổi');
    expect(db.classSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['s2'] }, status: 'SCHEDULED' } }),
    );
  });

  it('reports that the pushed lesson still fits when the term has slots left', async () => {
    const { service } = setup({ ...standardWeek(), unitToDate: '2030-01-20' });
    const result = (await service.cancelWithShift(manager, 's2', body, 'key-1')) as Record<
      string,
      unknown
    >;
    expect(result.pushedLessonFits).toBe(true);
  });

  it('only moves lessons of the same curriculum when the class has two', async () => {
    const fixture = standardWeek();
    fixture.sessions.splice(3, 0, session('sx', '2030-01-13', 'X1'));
    fixture.lessons.push(lesson('X1', 1, 'unit-2'));
    const { service, repo } = setup(fixture);
    await service.cancelWithShift(manager, 's3', body, 'key-1');
    expect(repo.applyLessons).toHaveBeenCalledWith(expect.anything(), [
      { sessionId: 's4', lessonId: 'L3' },
      { sessionId: 's5', lessonId: 'L4' },
    ]);
  });

  it('pushes the own lesson of a session outside any curriculum without moving others', async () => {
    const fixture = standardWeek();
    fixture.lessons[1] = lesson('L2', 2, null);
    const { service, repo } = setup(fixture);
    const result = (await service.cancelWithShift(manager, 's2', body, 'key-1')) as Record<
      string,
      unknown
    >;
    expect(repo.applyLessons).toHaveBeenCalledWith(expect.anything(), []);
    expect(result).toMatchObject({ pushedLesson: { id: 'L2' }, pushedLessonFits: false });
  });

  it('is blocked with 409 when a moved session has a booked makeup (SRS 5.6)', async () => {
    const { service, repo, db } = setup({ ...standardWeek(), booked: ['s4'] });
    const error = await rejection(service.cancelWithShift(manager, 's2', body, 'key-1'));
    expect(error).toMatchObject({ code: 'LESSON_SHIFT_BLOCKED', statusCode: 409 });
    expect(error.details).toEqual({ sessions: [{ sessionId: 's4', startsAt: at('2030-01-14') }] });
    expect(repo.applyLessons).not.toHaveBeenCalled();
    expect(db.classSession.updateMany).not.toHaveBeenCalled();
  });

  it('keeps the plain cancel checks and codes', async () => {
    const attended = setup({ ...standardWeek(), attended: ['s2'] });
    expect(
      await rejection(attended.service.cancelWithShift(manager, 's2', body, 'key-1')),
    ).toMatchObject({ code: 'SESSION_HAS_DEPENDENCIES' });
    const stale = setup(standardWeek());
    expect(
      await rejection(
        stale.service.cancelWithShift(manager, 's2', { ...body, expectedRevision: 3 }, 'key-1'),
      ),
    ).toMatchObject({ code: 'REVISION_CONFLICT' });
    const past = standardWeek();
    past.sessions[1] = { ...past.sessions[1], startsAt: new Date('2020-01-01T11:00:00.000Z') };
    expect(
      await rejection(setup(past).service.cancelWithShift(manager, 's2', body, 'key-1')),
    ).toMatchObject({ code: 'SESSION_LOCKED' });
    expect(
      await rejection(setup(standardWeek()).service.cancelWithShift(staff, 's2', body, 'key-1')),
    ).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  });

  it('replays the stored response for the same key and refuses another body', async () => {
    const { service, db, repo } = setup(standardWeek());
    const first = await service.cancelWithShift(manager, 's2', body, 'key-1');
    const stored = (call(db.sessionMutation.create)[0] as { data: Record<string, unknown> }).data;
    db.sessionMutation.findUnique.mockResolvedValue({ ...stored, actorUserId: manager.id });
    repo.applyLessons.mockClear();
    expect(await service.cancelWithShift(manager, 's2', body, 'key-1')).toEqual(first);
    expect(repo.applyLessons).not.toHaveBeenCalled();
    expect(
      await rejection(service.cancelWithShift(manager, 's2', { ...body, reason: 'Khác' }, 'key-1')),
    ).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});

describe('cancel preview', () => {
  it('writes nothing and returns the same moves as the real cancel', async () => {
    const { service, repo, db } = setup(standardWeek());
    const preview = (await service.cancelPreview(manager, 's2', { shiftLessons: true })) as {
      cancellable: boolean;
      shiftedSessions: Array<{ sessionId: string; toLesson: { id: string } }>;
      pushedLesson: { id: string };
    };
    expect(preview.cancellable).toBe(true);
    expect(preview.shiftedSessions.map((row) => [row.sessionId, row.toLesson.id])).toEqual([
      ['s3', 'L2'],
      ['s4', 'L3'],
      ['s5', 'L4'],
    ]);
    expect(preview.pushedLesson.id).toBe('L5');
    expect(repo.applyLessons).not.toHaveBeenCalled();
    expect(db.classSession.updateMany).not.toHaveBeenCalled();
    expect(repo.sessions).toHaveBeenCalledWith(db, ['s2'], false);
  });

  it('lists blockers with 200 instead of throwing', async () => {
    const { service } = setup({ ...standardWeek(), booked: ['s4'] });
    const preview = (await service.cancelPreview(manager, 's2', { shiftLessons: true })) as {
      cancellable: boolean;
      blockers: unknown[];
    };
    expect(preview.cancellable).toBe(false);
    expect(preview.blockers).toEqual([{ sessionId: 's4', code: 'LESSON_SHIFT_BLOCKED' }]);
  });

  it('returns 404 for an unknown session', async () => {
    const { service } = setup(standardWeek());
    expect(await rejection(service.cancelPreview(manager, 'nope', {}))).toMatchObject({
      code: 'SESSION_NOT_FOUND',
      statusCode: 404,
    });
  });
});

describe('bulk cancel', () => {
  const body = { sessionIds: ['s3', 's2'], reason: 'Nghỉ lễ', shiftLessons: true };

  it('cancels consecutive sessions in time order and notifies each class once', async () => {
    const { service, repo, db, notifications } = setup(standardWeek());
    const result = (await service.bulkCancel(manager, body, 'bulk-1')) as {
      cancelledCount: number;
      classes: Array<{ pushedLessons: Array<{ id: string }> }>;
    };
    expect(repo.applyLessons).toHaveBeenCalledWith(db, [
      { sessionId: 's4', lessonId: 'L2' },
      { sessionId: 's5', lessonId: 'L3' },
    ]);
    expect(result.cancelledCount).toBe(2);
    expect(result.classes[0].pushedLessons.map((row) => row.id)).toEqual(['L4', 'L5']);
    expect(notifications.send).toHaveBeenCalledTimes(1);
    expect(call(notifications.send)[3]).toBe('CLASS');
    expect(call(notifications.send)[6]).toContain('huỷ 2 buổi');
    expect(notifications.session).not.toHaveBeenCalled();
    const audits = (call(db.auditLog.createMany)[0] as { data: Array<{ action: string }> }).data;
    expect(audits.map((row) => row.action)).toEqual([
      'CLASS_SESSION_CANCELLED',
      'CLASS_SESSION_CANCELLED',
      'CLASS_SESSION_LESSONS_SHIFTED',
    ]);
    expect(db.sessionBulkCancel.create).toHaveBeenCalledTimes(1);
  });

  it('writes nothing and lists every blocked session with its reason', async () => {
    const fixture = standardWeek();
    fixture.sessions[0] = {
      ...fixture.sessions[0],
      startsAt: new Date('2020-01-06T11:00:00.000Z'),
    };
    const { service, repo, db } = setup({ ...fixture, attended: ['s2'] });
    const error = await rejection(
      service.bulkCancel(manager, { ...body, sessionIds: ['s1', 's2', 's3', 'gone'] }, 'bulk-1'),
    );
    expect(error).toMatchObject({ code: 'BULK_CANCEL_BLOCKED', statusCode: 409 });
    expect(error.details).toEqual({
      blockers: [
        { sessionId: 'gone', code: 'SESSION_NOT_FOUND' },
        { sessionId: 's1', code: 'SESSION_LOCKED' },
        { sessionId: 's2', code: 'ATTENDANCE_RECORDED' },
      ],
    });
    expect(db.classSession.updateMany).not.toHaveBeenCalled();
    expect(repo.applyLessons).not.toHaveBeenCalled();
  });

  it('only lets managers cancel and requires an idempotency key', async () => {
    const { service } = setup(standardWeek());
    expect(await rejection(service.bulkCancel(staff, body, 'bulk-1'))).toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    expect(await rejection(service.bulkCancel(manager, body, undefined))).toMatchObject({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      statusCode: 400,
    });
  });

  it('replays a finished request and refuses the key for another one', async () => {
    const { service, db, repo } = setup(standardWeek());
    const first = await service.bulkCancel(manager, body, 'bulk-1');
    const stored = (call(db.sessionBulkCancel.create)[0] as { data: Record<string, unknown> }).data;
    db.sessionBulkCancel.findUnique.mockResolvedValue(stored);
    repo.sessions.mockClear();
    // Order of ids does not matter for the same request.
    expect(
      await service.bulkCancel(manager, { ...body, sessionIds: ['s2', 's3'] }, 'bulk-1'),
    ).toEqual(first);
    expect(repo.sessions).not.toHaveBeenCalled();
    expect(
      await rejection(service.bulkCancel(manager, { ...body, reason: 'Khác' }, 'bulk-1')),
    ).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('preview without shift lists the sessions and moves nothing', async () => {
    const { service, repo } = setup(standardWeek());
    const preview = (await service.bulkCancelPreview(manager, {
      sessionIds: ['s2', 's3'],
    })) as { cancellable: boolean; classes: Array<{ shiftedSessions: unknown[] }> };
    expect(preview.cancellable).toBe(true);
    expect(preview.classes[0].shiftedSessions).toEqual([]);
    expect(repo.chain).not.toHaveBeenCalled();
  });
});

describe('cancel request contract', () => {
  it('accepts at most 200 distinct session ids', async () => {
    const tooMany = plainToInstance(SessionBulkCancelDto, {
      sessionIds: Array.from({ length: 201 }, (_, index) => `s${index}`),
      reason: 'Nghỉ lễ',
    });
    const duplicate = plainToInstance(SessionBulkCancelDto, {
      sessionIds: ['s1', 's1'],
      reason: 'Nghỉ lễ',
    });
    const fine = plainToInstance(SessionBulkCancelDto, { sessionIds: ['s1'], reason: 'Nghỉ lễ' });
    expect((await validate(tooMany)).map((row) => row.property)).toEqual(['sessionIds']);
    expect((await validate(duplicate)).map((row) => row.property)).toEqual(['sessionIds']);
    expect(await validate(fine)).toEqual([]);
  });

  it('keeps shiftLessons optional on the single cancel body', async () => {
    const legacy = plainToInstance(SessionCancelDto, { reason: 'Ốm', expectedRevision: 1 });
    expect(await validate(legacy)).toEqual([]);
  });

  it('routes the plain cancel to the unchanged path', async () => {
    const plain = { cancelSession: jest.fn().mockResolvedValue('plain') };
    const shifted = { cancelWithShift: jest.fn().mockResolvedValue('shifted') };
    const controller = new CurriculumSchedulingController(
      plain as never,
      shifted as never,
      {} as never,
    );
    expect(
      await controller.cancelSession(manager, 's1', 'k', { reason: 'Ốm', expectedRevision: 1 }),
    ).toBe('plain');
    expect(plain.cancelSession).toHaveBeenCalledWith(manager, 's1', 'Ốm', 1, 'k');
    expect(
      await controller.cancelSession(manager, 's1', 'k', {
        reason: 'Ốm',
        expectedRevision: 1,
        shiftLessons: true,
      }),
    ).toBe('shifted');
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
    closures?: Array<{ fromDate: string; toDate: string }>;
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
      fromDate: new Date('2030-01-07T00:00:00Z'),
      toDate: new Date('2030-01-20T00:00:00Z'),
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
      centerClosure: {
        findMany: jest.fn().mockResolvedValue(
          (options.closures ?? []).map((row) => ({
            fromDate: new Date(`${row.fromDate}T00:00:00Z`),
            toDate: new Date(`${row.toDate}T00:00:00Z`),
          })),
        ),
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

  it('skips center closures when counting positions from the start of the term', async () => {
    const result = await planSetup({
      closures: [{ fromDate: '2030-01-09', toDate: '2030-01-09' }],
    }).preview('2030-01-07', '2030-01-20');
    expect(result.slots.map((slot) => [slot.date, slot.lessonId])).toEqual([
      ['2030-01-07', 'L1'],
      ['2030-01-11', 'L2'],
      ['2030-01-14', 'L3'],
      ['2030-01-16', 'L4'],
      ['2030-01-18', 'L5'],
    ]);
    expect(result.unscheduledLessons.map((row) => row.id)).toEqual(['L6']);
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
        // A plain read would still see the pre-cancel snapshot: generate must not use it.
        findFirst: jest.fn().mockResolvedValue({
          startsAt: at('2030-01-11'),
          lesson: { id: 'L3', sequence: 3 },
        }),
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      centerClosure: { findMany: jest.fn().mockResolvedValue([]) },
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
