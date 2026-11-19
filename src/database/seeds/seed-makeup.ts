import type { Prisma } from '@prisma/client';
import { TET_BREAKS } from '../../common/lunar-new-year';
import { addDays, dateOnly, localInstant, studyDay } from './seed-calendar';

export function isSeedHoliday(day: Date): boolean {
  const key = dateOnly(day);
  return TET_BREAKS.some((range) => range.fromDate <= key && key <= range.toDate);
}

export interface MakeupWindowInput {
  sourceStartsAt: Date;
  startDate: Date;
  endDate: Date;
  today: Date;
  past: boolean;
}

/** Same 21-day catch-up window as dashboard fixtures; enrollment end is exclusive. */
export function makeupCandidateDays(input: MakeupWindowInput): Date[] {
  const source = studyDay(input.sourceStartsAt);
  const result: Date[] = [];
  for (let offset = 1; offset <= 21; offset++) {
    const day = addDays(source, offset);
    if (
      day < input.startDate ||
      day >= input.endDate ||
      isSeedHoliday(day) ||
      (input.past ? day >= input.today : day <= input.today)
    )
      continue;
    result.push(day);
  }
  return result;
}

export async function findMakeupTarget(
  tx: Prisma.TransactionClient,
  input: MakeupWindowInput & {
    classId: string;
    roomId: string;
    teacherId: string;
    studentProfileId: string;
    excludeSessionId?: string;
  },
): Promise<{ startsAt: Date; endsAt: Date } | undefined> {
  for (const day of makeupCandidateDays(input)) {
    const startsAt = localInstant(day, 14);
    const endsAt = localInstant(day, 16);
    const closure = await tx.centerClosure.findFirst({
      where: { fromDate: { lte: day }, toDate: { gte: day } },
      select: { id: true },
    });
    if (closure) continue;
    const conflict = await tx.classSession.findFirst({
      where: {
        ...(input.excludeSessionId ? { id: { not: input.excludeSessionId } } : {}),
        status: { not: 'CANCELLED' },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        OR: [
          { classId: input.classId },
          { roomId: input.roomId },
          { teacherId: input.teacherId },
          {
            participants: {
              some: {
                cancelled: false,
                attendance: { not: 'EXCUSED' },
                enrollment: { studentProfileId: input.studentProfileId },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    if (!conflict) return { startsAt, endsAt };
  }
  return undefined;
}
