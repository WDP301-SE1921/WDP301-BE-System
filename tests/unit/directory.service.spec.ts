import type { Prisma, UserRole } from '@prisma/client';

import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import type { DatabaseService } from '../../src/database/orm/database.service';
import { DirectoryService } from '../../src/modules/directory/directory.service';

describe('Parent directory access', () => {
  const user = (role: UserRole): AuthenticatedUser => ({ id: 'viewer', role }) as AuthenticatedUser;

  const parent = {
    id: 'parent-1',
    email: 'parent@example.com',
    parentProfile: { phone: '0901234567', _count: { students: 2 } },
  };
  const database = {
    user: {
      findMany: jest
        .fn<Promise<unknown[]>, [Prisma.UserFindManyArgs]>()
        .mockResolvedValue([parent]),
      count: jest.fn().mockResolvedValue(21),
    },
    $transaction: jest.fn(),
  };
  const service = new DirectoryService(database as unknown as DatabaseService);
  beforeEach(() => jest.clearAllMocks());

  it.each<UserRole>(['STAFF', 'MANAGER'])(
    'allows %s to read a paginated parent list',
    async (role) => {
      await expect(
        service.listParents(user(role), {
          page: 2,
          limit: 10,
          search: ' parent ',
          status: 'ACTIVE',
        }),
      ).resolves.toEqual({ items: [parent], page: 2, limit: 10, total: 21 });
      const query = database.user.findMany.mock.calls[0][0];
      expect(query).toMatchObject({
        where: { role: 'PARENT', status: 'ACTIVE' },
        skip: 10,
        take: 10,
        select: {
          email: true,
          parentProfile: { select: { _count: { select: { students: true } } } },
        },
      });
      expect(query.select?.passwordHash).toBeUndefined();
      expect(query.where?.OR).toEqual([
        { email: { contains: 'parent' } },
        { displayName: { contains: 'parent' } },
      ]);
    },
  );

  it.each<UserRole>(['PARENT', 'TEACHER', 'CURRICULUM_DESIGNER'])(
    'rejects %s before reading parent data',
    async (role) => {
      await expect(service.listParents(user(role), { page: 1, limit: 10 })).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(database.user.findMany).not.toHaveBeenCalled();
      expect(database.user.count).not.toHaveBeenCalled();
    },
  );

  it('keeps parent account editing restricted to managers', async () => {
    await expect(
      service.updateParent(user('STAFF'), 'parent-1', { status: 'DISABLED' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});
