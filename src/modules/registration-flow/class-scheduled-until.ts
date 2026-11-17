import type { Prisma } from '@prisma/client';

const HCM_OFFSET_MS = 7 * 3_600_000;

/**
 * Local date (UTC+7, `YYYY-MM-DD`) of each class's last session that is not cancelled.
 * Classes without such a session are absent from the map; callers report `null`.
 */
export async function scheduledUntilByClass(
  db: Pick<Prisma.TransactionClient, 'classSession'>,
  classIds: string[],
): Promise<Map<string, string>> {
  if (!classIds.length) return new Map();
  const rows = await db.classSession.groupBy({
    by: ['classId'],
    where: { classId: { in: [...new Set(classIds)] }, status: { not: 'CANCELLED' } },
    _max: { startsAt: true },
  });
  const result = new Map<string, string>();
  for (const row of rows) {
    const last = row._max.startsAt;
    if (last) result.set(row.classId, localDay(last));
  }
  return result;
}

export interface ScheduledRange {
  scheduledFrom: string;
  scheduledUntil: string;
}

/**
 * Local dates (UTC+7) of each class's first and last session that is not cancelled, in one query.
 * This is the class's real study period: a class has no start or end date of its own.
 */
export async function scheduledRangeByClass(
  db: Pick<Prisma.TransactionClient, 'classSession'>,
  classIds: string[],
): Promise<Map<string, ScheduledRange>> {
  if (!classIds.length) return new Map();
  const rows = await db.classSession.groupBy({
    by: ['classId'],
    where: { classId: { in: [...new Set(classIds)] }, status: { not: 'CANCELLED' } },
    _min: { startsAt: true },
    _max: { startsAt: true },
  });
  const result = new Map<string, ScheduledRange>();
  for (const row of rows) {
    const first = row._min.startsAt;
    const last = row._max.startsAt;
    if (first && last)
      result.set(row.classId, { scheduledFrom: localDay(first), scheduledUntil: localDay(last) });
  }
  return result;
}

function localDay(value: Date): string {
  return new Date(value.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 10);
}
