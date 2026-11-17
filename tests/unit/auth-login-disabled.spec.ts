import * as bcrypt from 'bcrypt';

import { AppError } from '../../src/common/errors/app.error';
import type { DatabaseService } from '../../src/database/orm/database.service';
import type { ObjectStorageService } from '../../src/integrations/object-storage.service';
import type { AuthSessionsRepository } from '../../src/modules/auth/auth-sessions.repository';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { UsersService } from '../../src/modules/users/users.service';

const PASSWORD = 'MatKhau123';

async function serviceFor(status: 'ACTIVE' | 'DISABLED'): Promise<AuthService> {
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const users = {
    findByEmailWithPassword: jest.fn().mockResolvedValue({
      id: 'parent-1',
      email: 'parent@example.com',
      passwordHash,
      status,
      deletedAt: null,
    }),
  };
  return new AuthService(
    {} as AuthSessionsRepository,
    {} as never,
    {} as DatabaseService,
    {} as never,
    users as unknown as UsersService,
    {} as ObjectStorageService,
  );
}

async function failure(promise: Promise<unknown>): Promise<{ code?: string; status?: number }> {
  try {
    await promise;
    return {};
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { code: error.code, status: error.statusCode };
  }
}

describe('login of a disabled account', () => {
  it('tells someone with the right password that the center disabled the account', async () => {
    const service = await serviceFor('DISABLED');
    expect(await failure(service.login('parent@example.com', PASSWORD))).toEqual({
      code: 'AUTH_ACCOUNT_DISABLED',
      status: 403,
    });
  });

  it('keeps the generic error for a wrong password so the lock is not revealed', async () => {
    const service = await serviceFor('DISABLED');
    expect(await failure(service.login('parent@example.com', 'SaiMatKhau1'))).toEqual({
      code: 'AUTH_INVALID_CREDENTIALS',
      status: 401,
    });
  });
});
