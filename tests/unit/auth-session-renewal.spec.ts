import { createHash } from 'node:crypto';

import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { AppError } from '../../src/common/errors/app.error';
import type { AppConfiguration } from '../../src/config/configuration';
import type { DatabaseService } from '../../src/database/orm/database.service';
import type { ObjectStorageService } from '../../src/integrations/object-storage.service';
import type {
  AuthSessionsRepository,
  AuthSessionWithUser,
} from '../../src/modules/auth/auth-sessions.repository';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { UsersService } from '../../src/modules/users/users.service';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-11-03T08:00:00.000Z');
const JWT = {
  accessSecret: 'renewal-access-secret-at-least-32-characters',
  refreshSecret: 'renewal-refresh-secret-at-least-32-characters',
  issuer: 'edugrade-api',
  audience: 'edugrade-clients',
  accessTtlSeconds: 900,
  refreshTtlSeconds: 7 * 86_400,
  sessionMaxAgeSeconds: 90 * 86_400,
};
const USER = {
  id: 'parent-1',
  email: 'parent@example.com',
  displayName: 'Phụ huynh',
  role: 'PARENT',
  status: 'ACTIVE',
  emailVerifiedAt: NOW,
  hasAvatar: false,
  createdAt: NOW,
  updatedAt: NOW,
};

interface Rotation {
  expiresAt?: Date;
}

interface Harness {
  service: AuthService;
  jwt: JwtService;
  refreshToken: string;
  rotateRefreshToken: jest.Mock<Promise<boolean>, [Rotation]>;
  revoke: jest.Mock<Promise<void>, [string, Date?]>;
}

async function setup(session: { createdAt: Date; expiresAt: Date }): Promise<Harness> {
  const jwt = new JwtService({});
  const refreshToken = await jwt.signAsync(
    { sub: USER.id, sid: 'session-1', role: 'PARENT', jti: 'jti-1', type: 'refresh' },
    { secret: JWT.refreshSecret, issuer: JWT.issuer, audience: JWT.audience, expiresIn: 60 },
  );
  const row = {
    id: 'session-1',
    userId: USER.id,
    refreshTokenHash: createHash('sha256').update(refreshToken).digest('hex'),
    revokedAt: null,
    updatedAt: session.createdAt,
    user: USER,
    ...session,
  } as unknown as AuthSessionWithUser;
  const rotateRefreshToken = jest.fn<Promise<boolean>, [Rotation]>(() => Promise.resolve(true));
  const revoke = jest.fn<Promise<void>, [string, Date?]>(() => Promise.resolve());
  const sessions = {
    findActiveSessionWithUser: (): Promise<AuthSessionWithUser> => Promise.resolve(row),
    rotateRefreshToken,
    revoke,
  };
  const config = { get: (): typeof JWT => JWT };
  const db = {
    parentProfile: { findUnique: (): Promise<{ phone: null }> => Promise.resolve({ phone: null }) },
  };
  const users = { toSafeUser: (): typeof USER => USER };
  const service = new AuthService(
    sessions as unknown as AuthSessionsRepository,
    config as unknown as ConfigService<AppConfiguration, true>,
    db as unknown as DatabaseService,
    jwt,
    users as unknown as UsersService,
    {} as ObjectStorageService,
  );
  return { service, jwt, refreshToken, rotateRefreshToken, revoke };
}

describe('AuthService sliding session expiry', () => {
  beforeEach(() => {
    // jsonwebtoken signs and verifies through callbacks: only the clock is faked
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('extends the session by the refresh TTL on every refresh', async () => {
    const { service, jwt, refreshToken, rotateRefreshToken } = await setup({
      createdAt: new Date(NOW.getTime() - 6 * DAY_MS),
      expiresAt: new Date(NOW.getTime() + DAY_MS),
    });

    const { tokens } = await service.refresh(refreshToken);

    const renewed = new Date(NOW.getTime() + 7 * DAY_MS);
    expect(rotateRefreshToken.mock.calls[0]?.[0].expiresAt).toEqual(renewed);
    const { exp } = jwt.decode<{ exp: number }>(tokens.refreshToken);
    expect(exp * 1000).toBe(renewed.getTime());
  });

  it('never extends past the max age counted from login', async () => {
    const createdAt = new Date(NOW.getTime() - 88 * DAY_MS);
    const { service, refreshToken, rotateRefreshToken } = await setup({
      createdAt,
      expiresAt: new Date(NOW.getTime() + DAY_MS),
    });

    await service.refresh(refreshToken);

    expect(rotateRefreshToken.mock.calls[0]?.[0].expiresAt).toEqual(
      new Date(createdAt.getTime() + 90 * DAY_MS),
    );
  });

  it('revokes a session that is already past the max age', async () => {
    const { service, refreshToken, revoke } = await setup({
      createdAt: new Date(NOW.getTime() - 91 * DAY_MS),
      expiresAt: new Date(NOW.getTime() + DAY_MS),
    });

    const error = await service.refresh(refreshToken).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('AUTH_INVALID_REFRESH_TOKEN');
    expect(revoke).toHaveBeenCalledWith('session-1', NOW);
  });
});
