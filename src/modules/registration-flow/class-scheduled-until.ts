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
    if (last)
      result.set(row.classId, new Date(last.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 10));
  }
  return result;
}
