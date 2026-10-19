import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import * as bcrypt from 'bcrypt';

import { AppError } from '../../common/errors/app.error';
import type { AppConfiguration } from '../../config/configuration';
import { DatabaseService } from '../../database/orm/database.service';
import { UsersService } from '../users/users.service';
import type { SafeUser } from '../users/users.repository';
import { AuthSessionsRepository } from './auth-sessions.repository';
import type { AuthResponseDto, AuthTokensDto } from './dto/auth-response.dto';
import type { RealtimeTicketDto } from './dto/realtime-ticket.dto';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import type { JwtPayload } from './jwt-payload';

const PASSWORD_HASH_ROUNDS = 12;
const BCRYPT_MAX_BYTES = 72;
const PENDING_REFRESH_TOKEN_HASH = '0'.repeat(64);
const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_PASSWORD_TTL_MS = 30 * 60 * 1000;
/** A ticket only has to survive the socket handshake. */
export const REALTIME_TICKET_TTL_SECONDS = 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly authSessionsRepository: AuthSessionsRepository,
    private readonly config: ConfigService<AppConfiguration, true>,
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async registerParent(input: {
    email: string;
    password: string;
    displayName?: string;
    phone?: string;
  }): Promise<AuthResponseDto> {
    this.assertPasswordWithinBcryptLimit(input.password);
    const passwordHash = await bcrypt.hash(input.password, PASSWORD_HASH_ROUNDS);
    const user = await this.usersService.createParent({
      email: input.email,
      passwordHash,
      displayName: input.displayName,
      phone: input.phone,
    });
    await this.issueEmailVerification(user.id, user.email);
    return this.createAuthenticatedSession(user);
  }

  async resendVerification(email: string): Promise<{ sent: boolean }> {
    const user = await this.usersService.findByEmailWithPassword(email);
    if (!user || user.role !== 'PARENT') return { sent: false };
    if (user.emailVerifiedAt) return { sent: true };
    return this.issueEmailVerification(user.id, user.email);
  }

  async verifyEmail(token: string): Promise<{ verified: true }> {
    const tokenHash = this.hashToken(token);
    const now = new Date();
    const record = await this.db.emailVerificationToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt <= now) {
      throw new AppError(
        'AUTH_INVALID_EMAIL_TOKEN',
        'Verification token is invalid or expired',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.db.$transaction([
      this.db.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: now } }),
      this.db.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: now } }),
    ]);
    return { verified: true };
  }

  async login(email: string, password: string): Promise<AuthResponseDto> {
    this.assertPasswordWithinBcryptLimit(password);
    const user = await this.usersService.findByEmailWithPassword(email);
    if (!user?.passwordHash || user.status !== 'ACTIVE') {
      throw this.invalidCredentialsError();
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw this.invalidCredentialsError();
    }

    return this.createAuthenticatedSession(this.usersService.toSafeUser(user));
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const now = new Date();
    const session = await this.authSessionsRepository.findActiveSessionWithUser(payload.sid, now);
    if (!session || session.userId !== payload.sub) {
      throw this.invalidRefreshTokenError();
    }

    const presentedHash = this.hashToken(refreshToken);
    if (!this.hashesMatch(session.refreshTokenHash, presentedHash)) {
      await this.authSessionsRepository.revoke(session.id, now);
      throw this.invalidRefreshTokenError();
    }

    const safeUser = await this.currentProfile(this.usersService.toSafeUser(session.user));
    const tokens = await this.signTokenPair(safeUser, session.id, session.expiresAt);
    const rotated = await this.authSessionsRepository.rotateRefreshToken({
      sessionId: session.id,
      previousRefreshTokenHash: presentedHash,
      nextRefreshTokenHash: this.hashToken(tokens.refreshToken),
      now,
    });

    if (!rotated) {
      await this.authSessionsRepository.revoke(session.id, new Date());
      throw this.invalidRefreshTokenError();
    }

    return { user: safeUser, tokens };
  }

  async logout(sessionId: string): Promise<{ revoked: true }> {
    await this.authSessionsRepository.revoke(sessionId);
    return { revoked: true };
  }

  async currentProfile(user: SafeUser): Promise<SafeUser> {
    const { id, email, displayName, role, status, emailVerifiedAt, createdAt, updatedAt } = user;
    const safe = { id, email, displayName, role, status, emailVerifiedAt, createdAt, updatedAt };
    if (user.role !== 'PARENT') return safe;
    const parent = await this.db.parentProfile.findUnique({
      where: { userId: user.id },
      select: { phone: true },
    });
    return { ...safe, phone: parent?.phone ?? null };
  }

  async updateProfile(
    user: SafeUser,
    input: { displayName?: string; phone?: string },
  ): Promise<SafeUser> {
    if (input.phone !== undefined && user.role !== 'PARENT') {
      throw new AppError(
        'PROFILE_PHONE_NOT_ALLOWED',
        'Only parent profiles have a phone number',
        HttpStatus.BAD_REQUEST,
      );
    }
    const updated = await this.db.$transaction(async (tx) => {
      const account = await tx.user.update({
        where: { id: user.id },
        data: input.displayName === undefined ? {} : { displayName: input.displayName },
      });
      if (input.phone !== undefined) {
        await tx.parentProfile.update({
          where: { userId: user.id },
          data: { phone: input.phone || null },
        });
      }
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'PROFILE_UPDATED',
          entityType: 'User',
          entityId: user.id,
        },
      });
      return account;
    });
    return this.currentProfile(this.usersService.toSafeUser(updated));
  }

  async changePassword(
    user: SafeUser & { sessionId?: string },
    input: { currentPassword: string; newPassword: string },
  ): Promise<{ changed: true }> {
    this.assertPasswordWithinBcryptLimit(input.currentPassword);
    this.assertPasswordWithinBcryptLimit(input.newPassword);
    const account = await this.usersService.findByEmailWithPassword(user.email);
    if (
      !account?.passwordHash ||
      !(await bcrypt.compare(input.currentPassword, account.passwordHash))
    ) {
      throw new AppError(
        'AUTH_CURRENT_PASSWORD_INVALID',
        'Current password is incorrect',
        HttpStatus.BAD_REQUEST,
      );
    }
    const passwordHash = await bcrypt.hash(input.newPassword, PASSWORD_HASH_ROUNDS);
    await this.db.$transaction([
      this.db.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.db.authSession.updateMany({
        where: { userId: user.id, id: { not: user.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.db.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.db.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'PASSWORD_CHANGED',
          entityType: 'User',
          entityId: user.id,
        },
      }),
    ]);
    return { changed: true };
  }

  async forgotPassword(email: string): Promise<{ accepted: true }> {
    const user = await this.usersService.findByEmailWithPassword(email);
    if (!user || user.status !== 'ACTIVE') return { accepted: true };
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const link = new URL('/reset-password', this.config.get('webOrigin', { infer: true }));
    link.searchParams.set('token', token);
    await this.db.$transaction(async (tx) => {
      const record = await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + RESET_PASSWORD_TTL_MS),
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: 'PASSWORD_RESET',
          aggregateType: 'PasswordResetToken',
          aggregateId: record.id,
          recipient: user.email,
          subject: 'EduGrade - Đặt lại mật khẩu',
          dedupeKey: `password-reset:${record.id}`,
          payload: { tokenHash, text: `Mở liên kết để đặt lại mật khẩu: ${link.toString()}` },
        },
      });
    });
    return { accepted: true };
  }

  async resetPassword(input: { token: string; newPassword: string }): Promise<{ reset: true }> {
    this.assertPasswordWithinBcryptLimit(input.newPassword);
    const record = await this.db.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(input.token) },
    });
    const now = new Date();
    if (!record || record.usedAt || record.expiresAt <= now) {
      throw new AppError(
        'AUTH_INVALID_RESET_TOKEN',
        'Reset token is invalid or expired',
        HttpStatus.BAD_REQUEST,
      );
    }
    const passwordHash = await bcrypt.hash(input.newPassword, PASSWORD_HASH_ROUNDS);
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${record.userId} FOR UPDATE`;
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        throw new AppError(
          'AUTH_INVALID_RESET_TOKEN',
          'Reset token is invalid or expired',
          HttpStatus.BAD_REQUEST,
        );
      }
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: now },
      });
      await tx.authSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: record.userId,
          action: 'PASSWORD_RESET',
          entityType: 'User',
          entityId: record.userId,
        },
      });
    });
    return { reset: true };
  }

  /**
   * Issues a realtime ticket for the caller's current session. Web clients keep their access
   * token in an httpOnly cookie, so their server fetches this ticket for the browser socket.
   * The ticket is rejected by every REST endpoint (JwtStrategy accepts `access` only).
   */
  async createRealtimeTicket(user: AuthenticatedUser): Promise<RealtimeTicketDto> {
    const config = this.config.get('jwt', { infer: true });
    const token = await this.jwtService.signAsync(
      {
        sub: user.id,
        sid: user.sessionId,
        role: user.role,
        jti: randomUUID(),
        type: 'realtime',
      } satisfies JwtPayload,
      {
        secret: config.accessSecret,
        issuer: config.issuer,
        audience: config.audience,
        expiresIn: REALTIME_TICKET_TTL_SECONDS,
        algorithm: 'HS256',
      },
    );
    return { token, expiresIn: REALTIME_TICKET_TTL_SECONDS };
  }

  /**
   * Socket handshake: an access token (mobile) or a realtime ticket (web). An access-token
   * socket closes at the token's expiry; a ticket socket gets one access-token lifetime from
   * the handshake. Either way the session is re-checked before every delivery.
   */
  async verifyRealtimeToken(
    token: string,
  ): Promise<{ userId: string; sessionId: string; expiresAt: number } | null> {
    try {
      const config = this.config.get('jwt', { infer: true });
      const payload = await this.jwtService.verifyAsync<JwtPayload & { exp: number }>(token, {
        secret: config.accessSecret,
        issuer: config.issuer,
        audience: config.audience,
        algorithms: ['HS256'],
      });
      if (!Number.isFinite(payload.exp)) return null;
      if (payload.type !== 'access' && payload.type !== 'realtime') return null;
      const user = await this.activeSessionUser(payload.sub, payload.sid);
      if (!user) return null;
      const expiresAt =
        payload.type === 'access'
          ? payload.exp * 1000
          : Date.now() + config.accessTtlSeconds * 1000;
      return { userId: user.id, sessionId: payload.sid, expiresAt };
    } catch {
      return null;
    }
  }

  /** True while the session is unrevoked, unexpired and its account active. */
  async isRealtimeSessionActive(userId: string, sessionId: string): Promise<boolean> {
    return !!(await this.activeSessionUser(userId, sessionId));
  }

  async validateAccessPayload(payload: JwtPayload): Promise<SafeUser | null> {
    if (payload.type !== 'access') return null;
    return this.activeSessionUser(payload.sub, payload.sid);
  }

  private async activeSessionUser(userId: string, sessionId: string): Promise<SafeUser | null> {
    const session = await this.authSessionsRepository.findActiveSessionWithUser(sessionId);
    if (!session || session.userId !== userId) return null;
    return this.usersService.toSafeUser(session.user);
  }

  private async createAuthenticatedSession(user: SafeUser): Promise<AuthResponseDto> {
    user = await this.currentProfile(user);
    const expiresAt = this.addSeconds(
      new Date(),
      this.config.get('jwt.refreshTtlSeconds', { infer: true }),
    );
    const temporarySession = await this.authSessionsRepository.create({
      userId: user.id,
      refreshTokenHash: PENDING_REFRESH_TOKEN_HASH,
      expiresAt,
    });
    const tokens = await this.signTokenPair(user, temporarySession.id, expiresAt);
    await this.authSessionsRepository.rotateRefreshToken({
      sessionId: temporarySession.id,
      previousRefreshTokenHash: PENDING_REFRESH_TOKEN_HASH,
      nextRefreshTokenHash: this.hashToken(tokens.refreshToken),
      now: new Date(),
    });
    return { user, tokens };
  }

  private async signTokenPair(
    user: SafeUser,
    sessionId: string,
    refreshExpiresAt: Date,
  ): Promise<AuthTokensDto> {
    const jwtConfig = this.config.get('jwt', { infer: true });
    const basePayload = {
      sub: user.id,
      sid: sessionId,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(
      { ...basePayload, jti: randomUUID(), type: 'access' } satisfies JwtPayload,
      {
        secret: jwtConfig.accessSecret,
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
        expiresIn: jwtConfig.accessTtlSeconds,
        algorithm: 'HS256',
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      { ...basePayload, jti: randomUUID(), type: 'refresh' } satisfies JwtPayload,
      {
        secret: jwtConfig.refreshSecret,
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
        expiresIn: this.secondsUntil(refreshExpiresAt),
        algorithm: 'HS256',
      },
    );

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer' as const,
      expiresIn: jwtConfig.accessTtlSeconds,
    };
  }

  private async verifyRefreshToken(refreshToken: string): Promise<JwtPayload> {
    try {
      const jwtConfig = this.config.get('jwt', { infer: true });
      const payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: jwtConfig.refreshSecret,
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
        algorithms: ['HS256'],
      });
      if (payload.type !== 'refresh') throw this.invalidRefreshTokenError();
      return payload;
    } catch {
      throw this.invalidRefreshTokenError();
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private async issueEmailVerification(userId: string, email: string): Promise<{ sent: boolean }> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    await this.db.$transaction(async (tx) => {
      const record = await tx.emailVerificationToken.create({
        data: {
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() + VERIFY_EMAIL_TTL_MS),
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: 'EMAIL_VERIFICATION',
          aggregateType: 'EmailVerificationToken',
          aggregateId: record.id,
          recipient: email,
          subject: 'EduGrade - Xác minh email',
          dedupeKey: `email-verification:${record.id}`,
          payload: { tokenHash, text: `Mã xác minh tài khoản EduGrade: ${token}` },
        },
      });
    });
    return { sent: true };
  }

  private hashesMatch(storedHash: string, presentedHash: string): boolean {
    const stored = Buffer.from(storedHash, 'hex');
    const presented = Buffer.from(presentedHash, 'hex');
    return stored.length === presented.length && timingSafeEqual(stored, presented);
  }

  private assertPasswordWithinBcryptLimit(password: string): void {
    if (Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_BYTES) {
      throw new AppError(
        'AUTH_PASSWORD_TOO_LONG',
        'Password must be at most 72 bytes for bcrypt',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private invalidCredentialsError(): AppError {
    return new AppError(
      'AUTH_INVALID_CREDENTIALS',
      'Invalid email or password',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private invalidRefreshTokenError(): AppError {
    return new AppError(
      'AUTH_INVALID_REFRESH_TOKEN',
      'Invalid refresh token',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * 1000);
  }

  private secondsUntil(date: Date): number {
    return Math.max(1, Math.floor((date.getTime() - Date.now()) / 1000));
  }
}
