import { EnrollmentWorkflowsService } from '../../src/modules/academic/enrollment-workflows.service';
import {
  extendEnrollment,
  inclusiveDays,
  resizeLeaveExtension,
} from '../../src/modules/academic/enrollment-extension';

const day = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const ymd = (value: Date): string => value.toISOString().slice(0, 10);

type Mocks = Record<string, jest.Mock>;
/** First argument of the first call, typed for assertions. */
function firstArg<T = { data: Record<string, unknown> }>(mock: jest.Mock): T {
  return (mock.mock.calls[0] as unknown[])[0] as T;
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

type FakeTx = Record<string, Mocks> & { $queryRaw: jest.Mock };

function extensionTx(enrollment: Record<string, unknown> | null): FakeTx {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    enrollment: {
      findUnique: jest.fn().mockResolvedValue(enrollment),
      findUniqueOrThrow: jest.fn().mockResolvedValue(enrollment),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    enrollmentExtension: {
      create: jest.fn(({ data }: { data: object }) => Promise.resolve({ id: 'ext-1', ...data })),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    classSession: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return tx as unknown as FakeTx;
}

describe('term extension', () => {
  const active = { id: 'enr-1', status: 'ACTIVE', endDate: day('2027-01-01') };

  it('counts inclusive leave days', () => {
    expect(inclusiveDays(day('2026-11-01'), day('2026-11-21'))).toBe(21);
  });

  it('extends the exclusive end date by the given days and audits it', async () => {
    const tx = extensionTx(active);
    const extension = await extendEnrollment(tx as never, {
      enrollmentId: 'enr-1',
      source: 'MANUAL',
      days: 21,
      reason: 'Bảo lưu nghỉ dài',
      actorUserId: 'staff-1',
    });
    expect(ymd(extension!.newEndDate)).toBe('2027-01-22');
    expect(tx.enrollment.update).toHaveBeenCalledWith({
      where: { id: 'enr-1' },
      data: { endDate: day('2027-01-22') },
    });
    expect(firstArg(tx.auditLog.create).data.action).toBe('ENROLLMENT_EXTEND');
  });

  it('does not check class capacity', async () => {
    const tx = extensionTx(active);
    await extendEnrollment(tx as never, {
      enrollmentId: 'enr-1',
      source: 'MANUAL',
      days: 7,
      reason: 'x',
      actorUserId: 'staff-1',
    });
    expect(tx.enrollment.findMany).not.toHaveBeenCalled();
  });

  it('rejects an ended enrollment, or skips it when asked', async () => {
    const ended = { ...active, status: 'ENDED' };
    const input = {
      enrollmentId: 'enr-1',
      source: 'MANUAL' as const,
      days: 7,
      reason: 'x',
      actorUserId: 'staff-1',
    };
    expect(await codeOf(extendEnrollment(extensionTx(ended) as never, input))).toBe(
      'ENROLLMENT_NOT_EXTENDABLE',
    );
    await expect(
      extendEnrollment(extensionTx(ended) as never, input, { skipIfNotExtendable: true }),
    ).resolves.toBeNull();
  });
});

describe('bảo lưu credit after a leave changes', () => {
  function withCredit(days: number): FakeTx {
    const tx = extensionTx({ id: 'enr-1', status: 'ACTIVE', endDate: day('2027-01-22') });
    tx.enrollmentExtension.findUnique.mockResolvedValue({
      id: 'ext-1',
      enrollmentId: 'enr-1',
      days,
      newEndDate: day('2027-01-22'),
    });
    return tx;
  }

  it('shrinks the credit to the days really missed', async () => {
    const tx = withCredit(21);
    expect(await resizeLeaveExtension(tx as never, 'leave-1', 16, 'staff-1')).toBe(-5);
    expect(tx.enrollment.update).toHaveBeenCalledWith({
      where: { id: 'enr-1' },
      data: { endDate: day('2027-01-17') },
    });
    expect(firstArg(tx.enrollmentExtension.update).data.days).toBe(16);
  });

  it('removes the credit when fewer than 14 days were missed', async () => {
    const tx = withCredit(21);
    expect(await resizeLeaveExtension(tx as never, 'leave-1', 10, 'staff-1')).toBe(-21);
    expect(tx.enrollmentExtension.delete).toHaveBeenCalled();
  });

  it('does nothing for a leave without credit', async () => {
    const tx = extensionTx(null);
    expect(await resizeLeaveExtension(tx as never, 'leave-1', 0, 'staff-1')).toBe(0);
  });
});

describe('attendance correction', () => {
  const teacher = { id: 'teacher-1', role: 'TEACHER' } as never;

  function service(
    session: Record<string, unknown>,
    row: Record<string, unknown> | null,
  ): { workflows: EnrollmentWorkflowsService; tx: Record<string, Mocks> } {
    const tx = {
      classSession: { findUniqueOrThrow: jest.fn().mockResolvedValue(session) },
      sessionParticipant: {
        findFirst: jest.fn().mockResolvedValue(row),
        update: jest.fn(({ data }: { data: object }) => Promise.resolve({ ...row, ...data })),
      },
      makeupBooking: { update: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const repo = { transaction: (work: (t: unknown) => unknown): unknown => work(tx), db: {} };
    const access = { session: jest.fn().mockResolvedValue(undefined) };
    const notifications = { workflow: jest.fn().mockResolvedValue(undefined) };
    const workflows = new EnrollmentWorkflowsService(
      repo as never,
      access as never,
      notifications as never,
    );
    // Family email lookup is not part of these rules.
    (workflows as unknown as { queueFamilyEmail: () => Promise<void> }).queueFamilyEmail =
      (): Promise<void> => Promise.resolve();
    return { workflows, tx };
  }

  const row = {
    id: 'part-1',
    enrollmentId: 'enr-1',
    attendance: 'ABSENT',
    replacementBookings: [],
    sourceBookings: [],
  };
  const input = { status: 'PRESENT' as const, reason: 'Đánh nhầm' };

  afterEach(() => jest.useRealTimers());

  it('lets a teacher correct on the same day', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-15T16:30:00.000Z') }); // 23:30 local
    const { workflows, tx } = service(
      { status: 'COMPLETED', startsAt: new Date('2026-11-15T12:00:00.000Z') }, // 19:00 local
      row,
    );
    await workflows.correctAttendance(teacher, 'ses-1', 'part-1', input);
    expect(tx.sessionParticipant.update).toHaveBeenCalledWith({
      where: { id: 'part-1' },
      data: { attendance: 'PRESENT' },
    });
    expect(firstArg(tx.auditLog.create).data.action).toBe('ATTENDANCE_CORRECTED');
  });

  it('locks after midnight of the session day', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-15T17:00:00.000Z') }); // 00:00 local, next day
    const { workflows } = service(
      { status: 'COMPLETED', startsAt: new Date('2026-11-15T12:00:00.000Z') },
      row,
    );
    expect(await codeOf(workflows.correctAttendance(teacher, 'ses-1', 'part-1', input))).toBe(
      'CORRECTION_WINDOW_CLOSED',
    );
  });

  it('keeps a makeup source absent and excused rows untouched', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-15T14:00:00.000Z') });
    const session = { status: 'COMPLETED', startsAt: new Date('2026-11-15T12:00:00.000Z') };
    const source = service(session, { ...row, sourceBookings: [{ id: 'mk-1' }] });
    expect(
      await codeOf(source.workflows.correctAttendance(teacher, 'ses-1', 'part-1', input)),
    ).toBe('MAKEUP_SOURCE_ABSENT');
    const excused = service(session, { ...row, attendance: 'EXCUSED' });
    expect(
      await codeOf(excused.workflows.correctAttendance(teacher, 'ses-1', 'part-1', input)),
    ).toBe('EXCUSED_REQUIRES_LEAVE');
  });

  it('syncs the makeup booking of a replacement seat', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-15T14:00:00.000Z') });
    const { workflows, tx } = service(
      { status: 'COMPLETED', startsAt: new Date('2026-11-15T12:00:00.000Z') },
      { ...row, replacementBookings: [{ id: 'mk-1', originalParticipantId: 'orig-1' }] },
    );
    await workflows.correctAttendance(teacher, 'ses-1', 'part-1', input);
    expect(tx.makeupBooking.update).toHaveBeenCalledWith({
      where: { id: 'mk-1' },
      data: { status: 'COMPLETED', activeOriginalId: 'orig-1' },
    });
  });

  it('rejects a session that is not finalized', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-15T14:00:00.000Z') });
    const { workflows } = service(
      { status: 'SCHEDULED', startsAt: new Date('2026-11-15T12:00:00.000Z') },
      row,
    );
    expect(await codeOf(workflows.correctAttendance(teacher, 'ses-1', 'part-1', input))).toBe(
      'SESSION_NOT_FINALIZED',
    );
  });
});
