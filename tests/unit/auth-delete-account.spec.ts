import * as bcrypt from 'bcrypt';

import { AppError } from '../../src/common/errors/app.error';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import type { DatabaseService } from '../../src/database/orm/database.service';
import type { ObjectStorageService } from '../../src/integrations/object-storage.service';
import type { AuthSessionsRepository } from '../../src/modules/auth/auth-sessions.repository';
import { AuthService } from '../../src/modules/auth/auth.service';
import {
  deletedAccountEmail,
  isDeletedAccountEmail,
  SELF_DELETE_REASON,
} from '../../src/modules/users/deleted-account';
import type { UsersService } from '../../src/modules/users/users.service';

const PASSWORD = 'MatKhau123';

const PARENT: AuthenticatedUser = {
  id: 'parent-1',
  email: 'parent@example.com',
  displayName: 'Phụ huynh',
  role: 'PARENT',
  status: 'ACTIVE',
  emailVerifiedAt: new Date('2026-11-01T00:00:00Z'),
  hasAvatar: true,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  sessionId: 'session-1',
};

/** Arguments Prisma writes take, as far as the assertions read them. */
interface Args {
  where?: Record<string, unknown>;
  data: Record<string, unknown>;
}

const write = (): jest.Mock<Promise<unknown>, [Args]> =>
  jest.fn<Promise<unknown>, [Args]>(() => Promise.resolve({}));

/** First call's argument of a write mock. */
function firstCall(mock: jest.Mock<Promise<unknown>, [Args]>): Args {
  return mock.mock.calls[0][0];
}

interface Row {
  email: string;
  avatarStorageKey: string | null;
  deletedAt: Date | null;
}

type WriteMock = jest.Mock<Promise<unknown>, [Args]>;

interface Tx {
  $queryRaw: jest.Mock;
  user: { findUnique: jest.Mock; update: WriteMock };
  parentProfile: { updateMany: WriteMock };
  authSession: { updateMany: WriteMock };
  pushSubscription: { deleteMany: WriteMock };
  emailVerificationToken: { updateMany: WriteMock };
  passwordResetToken: { updateMany: WriteMock };
  outboxEvent: { updateMany: WriteMock };
  auditLog: { create: WriteMock };
}

function makeTx(row: Row | null): Tx {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findUnique: jest.fn().mockResolvedValue(row), update: write() },
    parentProfile: { updateMany: write() },
    authSession: { updateMany: write() },
    pushSubscription: { deleteMany: write() },
    emailVerificationToken: { updateMany: write() },
    passwordResetToken: { updateMany: write() },
    outboxEvent: { updateMany: write() },
    auditLog: { create: write() },
  };
}

interface Harness {
  service: AuthService;
  tx: Tx;
  db: { $transaction: jest.Mock };
  storage: { deleteObject: jest.Mock };
  users: { findByEmailWithPassword: jest.Mock };
}

async function setup(
  row: Row | null = {
    email: PARENT.email,
    avatarStorageKey: 'avatars/parent-1/a.png',
    deletedAt: null,
  },
): Promise<Harness> {
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const tx = makeTx(row);
  const db = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const storage = { deleteObject: jest.fn().mockResolvedValue(undefined) };
  const users = {
    findByEmailWithPassword: jest.fn().mockResolvedValue({ id: PARENT.id, passwordHash }),
  };
  const service = new AuthService(
    {} as AuthSessionsRepository,
    {} as never,
    db as unknown as DatabaseService,
    {} as never,
    users as unknown as UsersService,
    storage as unknown as ObjectStorageService,
  );
  return { service, tx, db, storage, users };
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
}

describe('AuthService.deleteOwnAccount', () => {
  it('anonymizes the parent, ends every session and removes the avatar', async () => {
    const { service, tx, storage } = await setup();

    await expect(service.deleteOwnAccount(PARENT, PASSWORD)).resolves.toEqual({ deleted: true });

    const { data } = firstCall(tx.user.update);
    expect(data).toMatchObject({
      email: deletedAccountEmail(PARENT.id),
      displayName: null,
      passwordHash: null,
      avatarStorageKey: null,
      emailVerifiedAt: null,
      deletedById: PARENT.id,
      deleteReason: SELF_DELETE_REASON,
    });
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(tx.parentProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: PARENT.id },
      data: { phone: null },
    });
    expect(firstCall(tx.authSession.updateMany).where).toEqual({
      userId: PARENT.id,
      revokedAt: null,
    });
    expect(tx.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { userId: PARENT.id } });
    expect(firstCall(tx.outboxEvent.updateMany).where).toEqual({
      recipient: PARENT.email,
      status: 'PENDING',
    });
    expect(firstCall(tx.auditLog.create).data.action).toBe('ACCOUNT_SELF_DELETED');
    expect(storage.deleteObject).toHaveBeenCalledWith('avatars/parent-1/a.png');
  });

  it('rejects a wrong password without touching the account', async () => {
    const { service, db } = await setup();

    expect(await errorCode(service.deleteOwnAccount(PARENT, 'SaiMatKhau1'))).toBe(
      'AUTH_CURRENT_PASSWORD_INVALID',
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('refuses staff accounts', async () => {
    const { service, users } = await setup();

    for (const role of ['TEACHER', 'STAFF', 'MANAGER', 'CURRICULUM_DESIGNER', 'ADMIN'] as const) {
      expect(await errorCode(service.deleteOwnAccount({ ...PARENT, role }, PASSWORD))).toBe(
        'AUTH_ACCOUNT_DELETE_NOT_ALLOWED',
      );
    }
    expect(users.findByEmailWithPassword).not.toHaveBeenCalled();
  });

  it('is a no-op when a concurrent request already deleted the account', async () => {
    const { service, tx, storage } = await setup({
      email: deletedAccountEmail(PARENT.id),
      avatarStorageKey: null,
      deletedAt: new Date(),
    });

    await expect(service.deleteOwnAccount(PARENT, PASSWORD)).resolves.toEqual({ deleted: true });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('marks the anonymized address as undeliverable', () => {
    expect(isDeletedAccountEmail(deletedAccountEmail('abc'))).toBe(true);
    expect(isDeletedAccountEmail('parent@example.com')).toBe(false);
  });
});
