import { Prisma } from '@prisma/client';

export function assignedTeacherAt(
  classroom: {
    teacherId: string | null;
    pendingTeacherId: string | null;
    pendingTeacherFrom: Date | null;
  },
  at: Date,
): string | null {
  return classroom.pendingTeacherId &&
    classroom.pendingTeacherFrom &&
    classroom.pendingTeacherFrom <= at
    ? classroom.pendingTeacherId
    : classroom.teacherId;
}

export function assignedTeacherWhere(teacherId: string, at: Date): Prisma.ClassWhereInput {
  return {
    OR: [
      {
        teacherId,
        OR: [{ pendingTeacherFrom: null }, { pendingTeacherFrom: { gt: at } }],
      },
      { pendingTeacherId: teacherId, pendingTeacherFrom: { lte: at } },
    ],
  };
}
