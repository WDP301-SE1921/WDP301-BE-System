import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { createTransport } from 'nodemailer';

import { AppError } from '../../common/errors/app.error';
import type { AppConfiguration } from '../../config/configuration';
import { DatabaseService } from '../../database/orm/database.service';
import { UsersService } from '../users/users.service';
import type { SafeUser } from '../users/users.repository';
import { AuthSessionsRepository } from './auth-sessions.repository';
import type { AuthResponseDto, AuthTokensDto } from './dto/auth-response.dto';
import type { JwtPayload } from './jwt-payload';

const PASSWORD_HASH_ROUNDS = 12;
const BCRYPT_MAX_BYTES = 72;
const PENDING_REFRESH_TOKEN_HASH = '0'.repeat(64);
const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;

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

    const safeUser = this.usersService.toSafeUser(session.user);
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

  async validateAccessPayload(payload: JwtPayload): Promise<SafeUser | null> {
    if (payload.type !== 'access') return null;
    const session = await this.authSessionsRepository.findActiveSessionWithUser(payload.sid);
    if (!session || session.userId !== payload.sub) return null;
    return this.usersService.toSafeUser(session.user);
  }

  private async createAuthenticatedSession(user: SafeUser): Promise<AuthResponseDto> {
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
    await this.db.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + VERIFY_EMAIL_TTL_MS),
      },
    });
    const academicConfig = this.config.get('academic', { infer: true });
    if (!academicConfig.smtpUrl || !academicConfig.mailFrom) return { sent: false };
    const transport = createTransport(
      {
        url: academicConfig.smtpUrl,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      },
      { from: academicConfig.mailFrom },
    );
    try {
      await transport.sendMail({
        to: email,
        subject: 'EduGrade - Verify your email',
        text: `Use this verification token to activate your EduGrade account: ${token}`,
      });
      return { sent: true };
    } finally {
      transport.close();
    }
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
