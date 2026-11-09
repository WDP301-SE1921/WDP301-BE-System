import type { ConfigService } from '@nestjs/config';
import { Prisma, type UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';

import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import type { AppConfiguration } from '../../src/config/configuration';
import type { DatabaseService } from '../../src/database/orm/database.service';
import { DirectoryService } from '../../src/modules/directory/directory.service';

const actor = (role: UserRole): AuthenticatedUser =>
  ({ id: 'manager-1', role }) as AuthenticatedUser;
const input = {
  email: 'teacher@example.com',
  displayName: 'Nguyễn Giáo Viên',
  password: 'InitialPass123!',
};
const token = 'old-teacher-invitation-token';
type AsyncMock = jest.Mock<Promise<unknown>, unknown[]>;
interface AccountFixture {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
}
interface InvitationFixture {
  id: string;
  role: string;
  email: string;
  status: string;
  tokenHash: string;
  expiresAt: Date;
  acceptedUserId: string;
}
interface TestDatabase {
  user: {
    create: jest.Mock<Promise<AccountFixture>, [Prisma.UserCreateArgs]>;
    findUnique: AsyncMock;
    update: AsyncMock;
    findFirst: AsyncMock;
  };
  accountInvitation: Record<
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findFirst'
    | 'findMany'
    | 'count'
    | 'create'
    | 'updateMany'
    | 'update',
    AsyncMock
  >;
  auditLog: { create: AsyncMock };
  outboxEvent: { create: AsyncMock };
  $transaction: jest.Mock<Promise<unknown>, [(tx: TestDatabase) => Promise<unknown>]>;
}

describe('Manager-issued teacher accounts', () => {
  const setup = (): {
    db: TestDatabase;
    service: DirectoryService;
    account: AccountFixture;
    invitation: InvitationFixture;
  } => {
    const account = {
      id: 'teacher-1',
      email: input.email,
      displayName: input.displayName,
      role: 'TEACHER',
      status: 'ACTIVE',
    };
    const invitation = {
      id: 'invitation-1',
      role: 'TEACHER',
      email: input.email,
      status: 'INVITED',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 3600000),
      acceptedUserId: 'teacher-1',
    };
    const db: TestDatabase = {
      user: {
        create: jest
          .fn<Promise<AccountFixture>, [Prisma.UserCreateArgs]>()
          .mockResolvedValue(account),
        findUnique: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue(null),
        update: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue(account),
        findFirst: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue(account),
      },
      accountInvitation: {
        findUnique: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue(invitation),
        findUniqueOrThrow: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue(invitation),
        findFirst: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue(null),
        findMany: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue([invitation]),
        count: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue(0),
        create: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue(invitation),
        updateMany: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue({ count: 1 }),
        update: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue(invitation),
      },
      auditLog: { create: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue({}) },
      outboxEvent: { create: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue({}) },
      $transaction: jest.fn<Promise<unknown>, [(tx: TestDatabase) => Promise<unknown>]>(),
    };
    db.$transaction.mockImplementation((callback: (tx: typeof db) => Promise<unknown>) =>
      callback(db),
    );
    const service = new DirectoryService(
      db as unknown as DatabaseService,
      { get: () => 'http://localhost:3001' } as unknown as ConfigService<AppConfiguration, true>,
    );
    return { db, service, account, invitation };
  };

  it('creates an active verified teacher with a usable hash and secret-free result/audit', async () => {
    const { db, service, account } = setup();
    const result = await service.createAccount(actor('MANAGER'), 'TEACHER', input);
    expect(result).toEqual(account);
    const write = db.user.create.mock.calls[0][0];
    expect(write.data).toMatchObject({
      email: input.email,
      displayName: input.displayName,
      role: 'TEACHER',
      status: 'ACTIVE',
    });
    expect(write.data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await bcrypt.compare(input.password, write.data.passwordHash!)).toBe(true);
    expect(write.select?.passwordHash).toBeUndefined();
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'manager-1',
        action: 'TEACHER_ACCOUNT_CREATE',
        entityType: 'User',
        entityId: 'teacher-1',
        afterData: { email: input.email, role: 'TEACHER' },
      },
    });
    expect(JSON.stringify([result, db.auditLog.create.mock.calls])).not.toContain(input.password);
    expect(db.outboxEvent.create).not.toHaveBeenCalled();
  });

  it.each<UserRole>(['STAFF', 'TEACHER', 'PARENT', 'CURRICULUM_DESIGNER'])(
    'denies %s before any teacher write',
    async (role) => {
      const { db, service } = setup();
      await expect(service.createAccount(actor(role), 'TEACHER', input)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
      });
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it('enforces the bcrypt byte limit for teachers', async () => {
    const { db, service } = setup();
    await expect(
      service.createAccount(actor('MANAGER'), 'TEACHER', { ...input, password: 'ắ'.repeat(25) }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('keeps duplicate emails conflicted without activating an existing disabled account', async () => {
    const { db, service } = setup();
    db.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique email', {
        code: 'P2002',
        clientVersion: '6.16.2',
      }),
    );
    await expect(service.createAccount(actor('MANAGER'), 'TEACHER', input)).rejects.toMatchObject({
      code: 'AUTH_EMAIL_EXISTS',
      statusCode: 409,
    });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('rejects new teacher invitations before looking up email or queuing mail', async () => {
    const { db, service } = setup();
    await expect(
      service.invite(actor('MANAGER'), 'TEACHER', { email: input.email }),
    ).rejects.toMatchObject({ code: 'TEACHER_INVITATION_DISABLED', statusCode: 410 });
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it.each(['INVITED', 'ACCEPTED', 'APPROVED', 'REJECTED', 'REVOKED'])(
    'blocks accepting a historical %s teacher invitation without account changes',
    async (status) => {
      const { db, service, invitation } = setup();
      invitation.status = status;
      await expect(
        service.acceptInvitation({
          token,
          password: input.password,
          displayName: input.displayName,
        }),
      ).rejects.toMatchObject({ code: 'TEACHER_INVITATION_DISABLED', statusCode: 410 });
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['APPROVE', 'REJECT'] as const)(
    'blocks teacher review %s and leaves an accepted account disabled',
    async (decision) => {
      const { db, service, invitation } = setup();
      invitation.status = 'ACCEPTED';
      await expect(
        service.reviewInvitation(actor('MANAGER'), invitation.id, { decision }),
      ).rejects.toMatchObject({ code: 'TEACHER_INVITATION_DISABLED', statusCode: 410 });
      expect(db.user.update).not.toHaveBeenCalled();
      expect(db.accountInvitation.updateMany).not.toHaveBeenCalled();
    },
  );

  it('blocks resending a teacher invitation before rotating its token or queueing mail', async () => {
    const { db, service, invitation } = setup();
    await expect(service.resendInvitation(actor('MANAGER'), invitation.id)).rejects.toMatchObject({
      code: 'TEACHER_INVITATION_DISABLED',
      statusCode: 410,
    });
    expect(db.accountInvitation.updateMany).not.toHaveBeenCalled();
    expect(db.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('keeps historical teacher invitations readable and unused ones revocable', async () => {
    const { db, service, invitation } = setup();
    db.accountInvitation.count.mockResolvedValue(1);
    await expect(
      service.invitations(actor('MANAGER'), 'TEACHER', { page: 1, limit: 20 }),
    ).resolves.toMatchObject({ items: [invitation], total: 1 });
    await service.revokeInvitation(actor('MANAGER'), invitation.id);
    expect(db.accountInvitation.updateMany).toHaveBeenCalledWith({
      where: { id: invitation.id, status: 'INVITED' },
      data: {
        status: 'REVOKED',
        reviewedById: 'manager-1',
        reviewedAt: expect.any(Date) as unknown,
      },
    });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('allows an explicit manager update to enable an existing teacher', async () => {
    const { db, service } = setup();
    await service.updateAccount(actor('MANAGER'), 'TEACHER', 'teacher-1', { status: 'ACTIVE' });
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'teacher-1' }, data: { status: 'ACTIVE' } }),
    );
  });
});
