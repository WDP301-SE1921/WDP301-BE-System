import { HttpStatus, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';

import { AppError } from '../../common/errors/app.error';
import { UsersRepository, type SafeUser } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.usersRepository.findByEmail(this.normalizeEmail(email));
  }

  async createParent(input: {
    email: string;
    passwordHash: string;
    displayName?: string;
    phone?: string;
  }): Promise<SafeUser> {
    try {
      return await this.usersRepository.createParentAccount({
        email: this.normalizeEmail(input.email),
        passwordHash: input.passwordHash,
        displayName: input.displayName?.trim() || null,
        phone: input.phone?.trim() || null,
      });
    } catch (error) {
      if (this.usersRepository.isUniqueConstraintError(error)) {
        throw new AppError('AUTH_EMAIL_EXISTS', 'Email is already registered', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  toSafeUser(user: User): SafeUser {
    return this.usersRepository.toSafeUser(user);
  }
}
