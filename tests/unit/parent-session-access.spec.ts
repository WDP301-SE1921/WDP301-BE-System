import { parentSessionWhere } from '../../src/modules/curriculum-scheduling/parent-session-access';

describe('parentSessionWhere', () => {
  it('con chua co ghi danh nao thi khong khop buoi nao (Prisma coi OR rong la khong loc)', () => {
    expect(parentSessionWhere([])).toEqual({ id: { in: [] } });
  });

  it('co ghi danh thi gom dieu kien theo tung ghi danh', () => {
    const where = parentSessionWhere([
      {
        id: 'enrollment-1',
        classId: 'class-1',
        status: 'ACTIVE',
        endedAt: null,
        startDate: null,
        endDate: null,
        placements: [],
      },
    ]);
    expect(where.OR).toHaveLength(1);
  });
});
