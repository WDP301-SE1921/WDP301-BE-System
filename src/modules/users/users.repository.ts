import { Injectable } from '@nestjs/common';
import { Prisma, UserRole, UserStatus, type User } from '@prisma/client';

import { DatabaseService } from '../../database/orm/database.service';

export type SafeUser = Omit<User, 'passwordHash' | 'permissions'> & { phone?: string | null };

@Injectable()
export class UsersRepository {
  constructor(private readonly database: DatabaseService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.database.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.database.user.findUnique({ where: { id } });
  }

  createParentAccount(input: {
    email: string;
    passwordHash: string;
    displayName: string | null;
    phone: string | null;
  }): Promise<SafeUser> {
    return this.database.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          displayName: input.displayName,
          role: UserRole.PARENT,
          status: UserStatus.ACTIVE,
        },
      });

      await transaction.parentProfile.create({
        data: {
          userId: user.id,
          phone: input.phone,
        },
      });

      return this.toSafeUser(user);
    });
  }

  toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
