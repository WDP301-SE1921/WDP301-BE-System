import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AppError } from '../../common/errors/app.error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AcademicRepository } from './academic.repository';
import { assignedTeacherAt } from '../registration-flow/class-teacher';

export function assertRule(
  condition: unknown,
  code: string,
  message: string,
  status = HttpStatus.CONFLICT,
): asserts condition {
  if (!condition)
    throw new AppError(code, message, code === 'FORBIDDEN' ? HttpStatus.FORBIDDEN : status);
}
export function roles(user: AuthenticatedUser, ...allowed: UserRole[]): void {
  assertRule(allowed.includes(user.role), 'FORBIDDEN', 'Role is not allowed', HttpStatus.FORBIDDEN);
}
export function studyDate(date: Date): Date {
  return new Date(new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10) + 'T00:00:00Z');
}
export function inTerm(
  enrollment: { startDate: Date | null; endDate: Date | null; status: string },
  at: Date,
): boolean {
  const day = studyDate(at);
  return (
    enrollment.status === 'ACTIVE' &&
    !!enrollment.startDate &&
    !!enrollment.endDate &&
    enrollment.startDate <= day &&
    enrollment.endDate > day
  );
}

@Injectable()
export class AcademicAccessService {
  constructor(private readonly repo: AcademicRepository) {}

  async classroom(
    user: AuthenticatedUser,
    id: string,
    tx: Prisma.TransactionClient = this.repo.db,
  ): Promise<void> {
    roles(user, 'MANAGER', 'TEACHER');
    const classroom = await tx.class.findUnique({ where: { id } });
    assertRule(classroom, 'CLASS_NOT_FOUND', 'Class not found', HttpStatus.NOT_FOUND);
    assertRule(
      user.role === 'MANAGER' || assignedTeacherAt(classroom, new Date()) === user.id,
      'FORBIDDEN',
      'Class is not assigned to this teacher',
      HttpStatus.FORBIDDEN,
    );
  }

  async enrollment(
    user: AuthenticatedUser,
    id: string,
    tx: Prisma.TransactionClient = this.repo.db,
  ): Promise<void> {
    roles(user, 'MANAGER', 'STAFF', 'PARENT');
    const enrollment = await tx.enrollment.findUnique({
      where: { id },
      include: { studentProfile: { include: { parentProfile: true } } },
    });
    assertRule(enrollment, 'ENROLLMENT_NOT_FOUND', 'Enrollment not found', HttpStatus.NOT_FOUND);
    assertRule(
      user.role === 'MANAGER' ||
        user.role === 'STAFF' ||
        (enrollment.status !== 'PENDING_LINK' &&
          enrollment.studentProfile?.parentProfile.userId === user.id),
      'FORBIDDEN',
      'Enrollment does not belong to this parent',
      HttpStatus.FORBIDDEN,
    );
  }

  async session(
    user: AuthenticatedUser,
    id: string,
    tx: Prisma.TransactionClient = this.repo.db,
  ): Promise<void> {
    roles(user, 'MANAGER', 'TEACHER');
    const session = await tx.classSession.findUnique({ where: { id } });
    assertRule(session, 'SESSION_NOT_FOUND', 'Session not found', HttpStatus.NOT_FOUND);
    assertRule(
      user.role === 'MANAGER' || session.teacherId === user.id,
      'FORBIDDEN',
      'Session is not assigned to this teacher',
      HttpStatus.FORBIDDEN,
    );
  }
}
