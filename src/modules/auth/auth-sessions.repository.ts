import { Injectable } from '@nestjs/common';
import { UserStatus, type AuthSession, type User } from '@prisma/client';

import { DatabaseService } from '../../database/orm/database.service';

export type AuthSessionWithUser = AuthSession & { user: User };

@Injectable()
export class AuthSessionsRepository {
  constructor(private readonly database: DatabaseService) {}

  create(input: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<AuthSession> {
    return this.database.authSession.create({
      data: {
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
      },
    });
  }

  findActiveSessionWithUser(
    sessionId: string,
    now = new Date(),
  ): Promise<AuthSessionWithUser | null> {
    return this.database.authSession.findFirst({
      where: {
        id: sessionId,
        revokedAt: null,
        expiresAt: { gt: now },
        user: { status: UserStatus.ACTIVE },
      },
      include: { user: true },
    });
  }

  async rotateRefreshToken(input: {
    sessionId: string;
    previousRefreshTokenHash: string;
    nextRefreshTokenHash: string;
    now: Date;
  }): Promise<boolean> {
    const result = await this.database.authSession.updateMany({
      where: {
        id: input.sessionId,
        refreshTokenHash: input.previousRefreshTokenHash,
        revokedAt: null,
        expiresAt: { gt: input.now },
      },
      data: {
        refreshTokenHash: input.nextRefreshTokenHash,
      },
    });
    return result.count === 1;
  }

  async revoke(sessionId: string, now = new Date()): Promise<void> {
    await this.database.authSession.updateMany({
      where: {
        id: sessionId,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
  }
}
