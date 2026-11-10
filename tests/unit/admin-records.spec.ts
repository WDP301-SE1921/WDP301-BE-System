import { AdminRecordsService } from '../../src/modules/admin/admin-records.service';
import type { DatabaseService } from '../../src/database/orm/database.service';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';

/** Giả lập tối thiểu Prisma cho các câu hỏi đếm của xóa mềm. */
interface FakeData {
  rooms?: Array<{ id: string; name: string; deletedAt: Date | null }>;
  classesByRoom?: Array<{ roomId: string; _count: number }>;
}

function fakeDb(data: FakeData): {
  service: AdminRecordsService;
  updates: unknown[];
  audits: unknown[];
} {
  const updates: unknown[] = [];
  const audits: unknown[] = [];
  const db = {
    room: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve((data.rooms ?? []).filter((r) => where.id.in.includes(r.id))),
      ),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve((data.rooms ?? []).find((r) => r.id === where.id) ?? null),
      ),
      update: jest.fn((args: unknown) => {
        updates.push(args);
        return Promise.resolve({});
      }),
    },
    class: { groupBy: jest.fn(() => Promise.resolve(data.classesByRoom ?? [])) },
    auditLog: { create: jest.fn((args: unknown) => Promise.resolve(audits.push(args))) },
    $queryRaw: jest.fn(() => Promise.resolve([])),
  };
  const service = new AdminRecordsService({
    ...db,
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
  } as unknown as DatabaseService);
  return { service, updates, audits };
}

const admin = { id: 'admin-1', role: 'ADMIN', sessionId: 's1' } as AuthenticatedUser;
const manager = { id: 'm-1', role: 'MANAGER', sessionId: 's2' } as AuthenticatedUser;

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'NO_ERROR';
  } catch (error) {
    return (error as { code: string }).code;
  }
}

describe('AdminRecordsService', () => {
  it('only lets ADMIN soft delete', async () => {
    const { service } = fakeDb({ rooms: [{ id: 'r1', name: 'P1', deletedAt: null }] });
    expect(await code(service.remove(manager, 'room', 'r1', 'x'))).toBe('ADMIN_ONLY');
  });

  it('refuses to delete a room still used by live classes (delete inside out)', async () => {
    const { service, updates } = fakeDb({
      rooms: [{ id: 'r1', name: 'P1', deletedAt: null }],
      classesByRoom: [{ roomId: 'r1', _count: 2 }],
    });
    expect(await code(service.remove(admin, 'room', 'r1', 'x'))).toBe('RECORD_IN_USE');
    expect(updates).toHaveLength(0);
  });

  it('soft deletes with who / why and writes an audit row, keeping the original status', async () => {
    const { service, updates, audits } = fakeDb({
      rooms: [{ id: 'r1', name: 'P1', deletedAt: null }],
    });
    expect(await code(service.remove(admin, 'room', 'r1', 'Không còn sử dụng'))).toBe('NO_ERROR');
    const data = (updates[0] as { data: Record<string, unknown> }).data;
    expect(data.deletedById).toBe('admin-1');
    expect(data.deleteReason).toBe('Không còn sử dụng');
    expect(data).not.toHaveProperty('isActive');
    expect(audits).toHaveLength(1);
  });

  it('refuses to delete twice and to restore a live record', async () => {
    const deleted = fakeDb({ rooms: [{ id: 'r1', name: 'P1', deletedAt: new Date() }] });
    expect(await code(deleted.service.remove(admin, 'room', 'r1', 'x'))).toBe('RECORD_DELETED');
    const live = fakeDb({ rooms: [{ id: 'r1', name: 'P1', deletedAt: null }] });
    expect(await code(live.service.restore(admin, 'room', 'r1', 'x'))).toBe('RECORD_NOT_DELETED');
  });

  it('restore clears only the soft delete columns', async () => {
    const { service, updates } = fakeDb({
      rooms: [{ id: 'r1', name: 'P1', deletedAt: new Date() }],
    });
    expect(await code(service.restore(admin, 'room', 'r1', 'Xóa nhầm'))).toBe('NO_ERROR');
    expect((updates[0] as { data: unknown }).data).toEqual({
      deletedAt: null,
      deletedById: null,
      deleteReason: null,
    });
  });
});
