import { RegistrationFlowService } from '../../src/modules/registration-flow/registration-flow.service';

const manager = { id: 'manager-1', role: 'MANAGER' } as never;
const program = {
  id: 'program-1',
  isActive: true,
  deletedAt: null,
  subjectRecord: { id: 'subject-1', isActive: true, deletedAt: null },
};
const day = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const FAR_END = day('2099-01-01');
const PAST_START = day('2020-01-01');

async function errorOf(
  promise: Promise<unknown>,
): Promise<{ code?: string; details?: unknown } | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error as { code?: string; details?: unknown };
  }
}

function enrollments(classId: string, count: number): unknown[] {
  return Array.from({ length: count }, () => ({
    classId,
    startDate: PAST_START,
    endDate: FAR_END,
    class: { weeklySchedules: [] },
    placements: [],
  }));
}

function makeDb(over: Record<string, unknown> = {}): Record<string, any> {
  const db: Record<string, any> = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'teacher-1' }) },
    program: { findUnique: jest.fn().mockResolvedValue(program) },
    room: {
      findFirst: jest.fn().mockResolvedValue({ id: 'room-1', capacity: 30 }),
      findUnique: jest.fn().mockResolvedValue({ id: 'room-1', capacity: 30 }),
      update: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ id: 'room-1', ...data })),
    },
    class: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'class-1', roomId: 'room-0', capacity: 25, weeklySchedules: [] }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    enrollment: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    ...over,
  };
  db.$transaction = jest.fn((work: (tx: unknown) => unknown) => work(db));
  return db;
}

function serviceOn(db: Record<string, any>): RegistrationFlowService {
  const service = new RegistrationFlowService(db as never, {} as never);
  // The program row lock is a raw query that is not what this spec is about.
  (service as any).lockClassProgram = jest.fn().mockResolvedValue(program);
  return service;
}

describe('class capacity follows the room', () => {
  describe('POST classes', () => {
    const input = { programId: 'program-1', name: 'Toán 9C', monthlyFee: 1_200_000 };

    it('copies the room capacity and ignores a sent capacity', async () => {
      const db = makeDb();
      await serviceOn(db).createClass(manager, {
        ...input,
        roomId: 'room-1',
        capacity: 5,
      } as never);
      expect(db.class.create.mock.calls[0][0].data).toMatchObject({
        roomId: 'room-1',
        capacity: 30,
      });
    });

    it('requires a room', async () => {
      const db = makeDb();
      const error = await errorOf(serviceOn(db).createClass(manager, input as never));
      expect(error?.code).toBe('ROOM_REQUIRED');
      expect(db.class.create).not.toHaveBeenCalled();
    });

    it('requires an active room', async () => {
      const db = makeDb();
      db.room.findFirst.mockResolvedValue(null);
      const error = await errorOf(
        serviceOn(db).createClass(manager, { ...input, roomId: 'gone' } as never),
      );
      expect(error?.code).toBe('INVALID_ROOM');
    });
  });

  describe('PATCH classes', () => {
    it('follows a new room and ignores a sent capacity', async () => {
      const db = makeDb();
      await serviceOn(db).updateClass(manager, 'class-1', {
        roomId: 'room-1',
        capacity: 5,
      } as never);
      expect(db.class.update.mock.calls[0][0].data).toMatchObject({
        roomId: 'room-1',
        capacity: 30,
      });
    });

    it('keeps a legacy class without room untouched when roomId is not sent', async () => {
      const db = makeDb();
      db.class.findUnique.mockResolvedValue({
        id: 'class-1',
        roomId: null,
        capacity: 25,
        weeklySchedules: [],
      });
      await serviceOn(db).updateClass(manager, 'class-1', {
        name: 'Toán 9D',
        capacity: 5,
      } as never);
      const data = db.class.update.mock.calls[0][0].data;
      expect(data).toEqual({ name: 'Toán 9D' });
      expect(db.room.findFirst).not.toHaveBeenCalled();
    });

    it('rejects roomId null with ROOM_REQUIRED', async () => {
      const db = makeDb();
      const error = await errorOf(
        serviceOn(db).updateClass(manager, 'class-1', { roomId: null } as never),
      );
      expect(error?.code).toBe('ROOM_REQUIRED');
      expect(db.class.update).not.toHaveBeenCalled();
    });

    it('blocks a smaller room than the reserved seats and reports them', async () => {
      const db = makeDb();
      db.room.findFirst.mockResolvedValue({ id: 'room-small', capacity: 20 });
      db.enrollment.findMany.mockResolvedValue(enrollments('class-1', 22));
      const error = await errorOf(
        serviceOn(db).updateClass(manager, 'class-1', { roomId: 'room-small' } as never),
      );
      expect(error?.code).toBe('ROOM_CAPACITY_TOO_SMALL');
      expect(error?.details).toMatchObject({ reservedSeats: 22 });
      expect(db.class.update).not.toHaveBeenCalled();
    });

    it('counts the peak of placed-in, chained and future segments, not ended ones', async () => {
      const db = makeDb();
      db.room.findFirst.mockResolvedValue({ id: 'room-small', capacity: 3 });
      const at = (offsetDays: number): Date => new Date(Date.now() + offsetDays * 86_400_000);
      const seg = (start: Date, end: Date, classId = 'class-1'): unknown => ({
        classId,
        startDate: start,
        endDate: end,
        class: { weeklySchedules: [] },
        placements: [],
      });
      db.enrollment.findMany.mockResolvedValue([
        seg(at(-90), at(-10)),
        seg(at(-90), at(-1)),
        seg(at(10), FAR_END),
        seg(at(10), FAR_END),
        seg(at(-30), at(50)),
        seg(at(50), FAR_END),
        {
          ...(seg(PAST_START, FAR_END, 'class-9') as object),
          placements: [
            {
              classId: 'class-1',
              effectiveFrom: at(-20),
              effectiveTo: null,
              class: { weeklySchedules: [] },
            },
          ],
        },
      ]);
      const error = await errorOf(
        serviceOn(db).updateClass(manager, 'class-1', { roomId: 'room-small' } as never),
      );
      expect(error?.code).toBe('ROOM_CAPACITY_TOO_SMALL');
      expect(error?.details).toMatchObject({ reservedSeats: 4 });
    });

    it('rejects an empty roomId with ROOM_REQUIRED', async () => {
      const db = makeDb();
      const error = await errorOf(
        serviceOn(db).updateClass(manager, 'class-1', { roomId: '' } as never),
      );
      expect(error?.code).toBe('ROOM_REQUIRED');
    });

    it('allows a room that exactly fits the reserved seats', async () => {
      const db = makeDb();
      db.room.findFirst.mockResolvedValue({ id: 'room-fit', capacity: 22 });
      db.enrollment.findMany.mockResolvedValue(enrollments('class-1', 22));
      await serviceOn(db).updateClass(manager, 'class-1', { roomId: 'room-fit' } as never);
      expect(db.class.update.mock.calls[0][0].data.capacity).toBe(22);
    });
  });

  describe('PATCH rooms', () => {
    it('cascades a new capacity to its classes in the same transaction', async () => {
      const db = makeDb();
      db.class.findMany.mockResolvedValue([
        { id: 'class-1', name: 'A' },
        { id: 'class-2', name: 'B' },
      ]);
      db.enrollment.findMany.mockResolvedValue(enrollments('class-1', 10));
      await serviceOn(db).updateRoom(manager, 'room-1', { capacity: 15 } as never);
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.class.updateMany).toHaveBeenCalledWith({
        where: { roomId: 'room-1', deletedAt: null },
        data: { capacity: 15 },
      });
    });

    it('blocks when a class has more reserved seats and lists the classes', async () => {
      const db = makeDb();
      db.class.findMany.mockResolvedValue([
        { id: 'class-1', name: 'A' },
        { id: 'class-2', name: 'B' },
      ]);
      db.enrollment.findMany.mockResolvedValue([
        ...enrollments('class-1', 18),
        ...enrollments('class-2', 5),
      ]);
      const error = await errorOf(
        serviceOn(db).updateRoom(manager, 'room-1', { capacity: 15 } as never),
      );
      expect(error?.code).toBe('ROOM_CAPACITY_TOO_SMALL');
      expect(error?.details).toMatchObject({
        classes: [{ id: 'class-1', name: 'A', reservedSeats: 18 }],
      });
      expect(db.room.update).not.toHaveBeenCalled();
      expect(db.class.updateMany).not.toHaveBeenCalled();
    });

    it('does not touch classes when only the name changes', async () => {
      const db = makeDb();
      await serviceOn(db).updateRoom(manager, 'room-1', { name: 'P.101' } as never);
      expect(db.class.findMany).not.toHaveBeenCalled();
      expect(db.class.updateMany).not.toHaveBeenCalled();
    });
  });
});
