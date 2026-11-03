import { createHash } from 'node:crypto';

import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';

import { AppError } from '../../src/common/errors/app.error';
import type { AppConfiguration } from '../../src/config/configuration';
import type { DatabaseService } from '../../src/database/orm/database.service';
import type { ObjectStorageService } from '../../src/integrations/object-storage.service';
import type { AuthSessionsRepository } from '../../src/modules/auth/auth-sessions.repository';
import {
  AuthService,
  VERIFY_EMAIL_CODE_MAX_ATTEMPTS,
  VERIFY_EMAIL_CODES_PER_HOUR,
} from '../../src/modules/auth/auth.service';
import type { UsersService } from '../../src/modules/users/users.service';

interface TokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  failedAttempts: number;
  createdAt: Date;
}

type Where = Record<string, unknown>;
type Data = Record<string, unknown>;

const PARENT = {
  id: 'parent-1',
  email: 'parent@example.com',
  role: 'PARENT',
  emailVerifiedAt: null,
};
const MINUTE_MS = 60_000;

/** Supports the where shapes the service uses: equality, null, `{ gt }` and `{ lt }`. */
function matches(row: TokenRow, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key as keyof TokenRow];
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      const { gt, lt } = condition as { gt?: Date | number; lt?: Date | number };
      if (gt !== undefined && !(Number(value) > Number(gt))) return false;
      if (lt !== undefined && !(Number(value) < Number(lt))) return false;
      return true;
    }
    return value === condition;
  });
}

function apply(row: TokenRow, data: Data): void {
  for (const [key, value] of Object.entries(data)) {
    const field = key as keyof TokenRow;
    if (value !== null && typeof value === 'object' && 'increment' in value) {
      (row[field] as number) += (value as { increment: number }).increment;
    } else {
      (row as unknown as Record<string, unknown>)[field] = value;
    }
  }
}

interface Harness {
  service: AuthService;
  tokens: TokenRow[];
  emails: { subject: string; text: string }[];
  verifiedAt: jest.Mock<Promise<unknown>, [{ where: { id: string }; data: Data }]>;
  lastCode: () => string;
  verify: (code: string) => Promise<{ verified: true }>;
  wrongCode: (code: string) => string;
}

function setup(): Harness {
  const tokens: TokenRow[] = [];
  const emails: { subject: string; text: string }[] = [];
  const verifiedAt = jest.fn<Promise<unknown>, [{ where: { id: string }; data: Data }]>(() =>
    Promise.resolve({}),
  );
  // Like Prisma, reads return copies: a later write must not change a row already read
  const copy = (row: TokenRow | undefined): Promise<TokenRow | null> =>
    Promise.resolve(row ? { ...row } : null);
  const emailVerificationToken = {
    count: ({ where }: { where: Where }): Promise<number> =>
      Promise.resolve(tokens.filter((row) => matches(row, where)).length),
    create: ({
      data,
    }: {
      data: Omit<TokenRow, 'usedAt' | 'failedAttempts' | 'createdAt'>;
    }): Promise<TokenRow | null> => {
      const row = { ...data, usedAt: null, failedAttempts: 0, createdAt: new Date() };
      tokens.push(row);
      return copy(row);
    },
    updateMany: ({ where, data }: { where: Where; data: Data }): Promise<{ count: number }> => {
      const rows = tokens.filter((row) => matches(row, where));
      rows.forEach((row) => apply(row, data));
      return Promise.resolve({ count: rows.length });
    },
    update: ({ where, data }: { where: { id: string }; data: Data }): Promise<TokenRow | null> => {
      const row = tokens.find(({ id }) => id === where.id);
      if (row) apply(row, data);
      return copy(row);
    },
    findFirst: ({ where }: { where: Where }): Promise<TokenRow | null> =>
      copy(
        tokens
          .filter((row) => matches(row, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0],
      ),
    findUnique: ({ where }: { where: { tokenHash: string } }): Promise<TokenRow | null> =>
      copy(tokens.find(({ tokenHash }) => tokenHash === where.tokenHash)),
  };
  const db = {
    emailVerificationToken,
    outboxEvent: {
      create: ({
        data,
      }: {
        data: { subject: string; payload: { text: string } };
      }): Promise<object> => {
        emails.push({ subject: data.subject, text: data.payload.text });
        return Promise.resolve({});
      },
    },
    user: { update: verifiedAt },
    $transaction: (work: unknown): Promise<unknown> =>
      typeof work === 'function'
        ? (work as (tx: unknown) => Promise<unknown>)(db)
        : Promise.all(work as Promise<unknown>[]),
  };
  const users = { findByEmailWithPassword: (): Promise<typeof PARENT> => Promise.resolve(PARENT) };
  const service = new AuthService(
    {} as AuthSessionsRepository,
    {} as ConfigService<AppConfiguration, true>,
    db as unknown as DatabaseService,
    {} as JwtService,
    users as unknown as UsersService,
    {} as ObjectStorageService,
  );

  const lastCode = (): string => {
    const match = /\b(\d{6})\b/.exec(emails[emails.length - 1]?.text ?? '');
    if (!match?.[1]) throw new Error('No code in the last email');
    return match[1];
  };
  const verify = (code: string): Promise<{ verified: true }> =>
    service.verifyEmail({ email: PARENT.email, code });
  const wrongCode = (code: string): string => (code === '000000' ? '000001' : '000000');
  return { service, tokens, emails, verifiedAt, lastCode, verify, wrongCode };
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error('Expected an AppError');
}

describe('AuthService 6-digit email verification codes', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-03T08:00:00.000Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('emails a 6-digit code in the body only and verifies it with the account email', async () => {
    const { service, emails, tokens, verifiedAt, lastCode, verify } = setup();
    await service.resendVerification(PARENT.email);
    const code = lastCode();

    expect(emails[0]?.subject).not.toContain(code);
    expect(emails[0]?.text).toContain('15 phút');
    expect(tokens[0]?.tokenHash).not.toBe(createHash('sha256').update(code).digest('hex'));

    await expect(verify(code)).resolves.toEqual({ verified: true });
    expect(verifiedAt).toHaveBeenCalledWith({
      where: { id: PARENT.id },
      data: { emailVerifiedAt: new Date('2026-11-03T08:00:00.000Z') },
    });
    expect(tokens[0]?.usedAt).not.toBeNull();
    expect(await errorCode(verify(code))).toBe('AUTH_INVALID_EMAIL_TOKEN');
  });

  it('stops accepting the code after the allowed wrong tries', async () => {
    const { service, tokens, lastCode, verify, wrongCode } = setup();
    await service.resendVerification(PARENT.email);
    const code = lastCode();

    for (let attempt = 1; attempt < VERIFY_EMAIL_CODE_MAX_ATTEMPTS; attempt += 1) {
      expect(await errorCode(verify(wrongCode(code)))).toBe('AUTH_INVALID_EMAIL_TOKEN');
    }
    expect(await errorCode(verify(wrongCode(code)))).toBe('AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED');
    expect(tokens[0]?.failedAttempts).toBe(VERIFY_EMAIL_CODE_MAX_ATTEMPTS);
    expect(await errorCode(verify(code))).toBe('AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED');
  });

  it('expires the previous code when a new one is sent, and every code after 15 minutes', async () => {
    const { service, lastCode, verify } = setup();
    await service.resendVerification(PARENT.email);
    const first = lastCode();
    jest.advanceTimersByTime(MINUTE_MS);
    await service.resendVerification(PARENT.email);
    const second = lastCode();

    if (first !== second) expect(await errorCode(verify(first))).toBe('AUTH_INVALID_EMAIL_TOKEN');
    jest.advanceTimersByTime(15 * MINUTE_MS);
    expect(await errorCode(verify(second))).toBe('AUTH_INVALID_EMAIL_TOKEN');
  });

  it('limits how many codes one account gets per hour', async () => {
    const { service } = setup();
    for (let sent = 0; sent < VERIFY_EMAIL_CODES_PER_HOUR; sent += 1) {
      await service.resendVerification(PARENT.email);
      jest.advanceTimersByTime(MINUTE_MS);
    }
    expect(await errorCode(service.resendVerification(PARENT.email))).toBe(
      'AUTH_VERIFICATION_RATE_LIMITED',
    );
    jest.advanceTimersByTime(60 * MINUTE_MS);
    await expect(service.resendVerification(PARENT.email)).resolves.toEqual({ sent: true });
  });

  it('still accepts the long token of emails sent before codes', async () => {
    const { service, tokens, verifiedAt } = setup();
    const token = 'a'.repeat(43);
    tokens.push({
      id: 'legacy',
      userId: PARENT.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date('2026-11-04T00:00:00.000Z'),
      usedAt: null,
      failedAttempts: 0,
      createdAt: new Date('2026-11-03T00:00:00.000Z'),
    });

    await expect(service.verifyEmail({ token })).resolves.toEqual({ verified: true });
    expect(verifiedAt).toHaveBeenCalledTimes(1);
  });
});
