import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Session reads that need SQL Prisma cannot express: a TiDB pessimistic transaction reads
 * plain SELECTs from its start snapshot, so rows checked after a lock are read with `FOR UPDATE`.
 */
@Injectable()
export class SessionRowsRepository {
  /**
   * Last session not cancelled of a class that teaches a lesson of the unit, read with a lock
   * so a generation that waited for a concurrent change sees it. Sessions cancelled before
   * 19/11/2026 are skipped. The subquery is a plain read: lesson unit and kind do not change
   * once scheduled.
   */
  async lastUnitSession(
    tx: Prisma.TransactionClient,
    classId: string,
    unitId: string,
  ): Promise<{ startsAt: Date; lessonId: string } | null> {
    const rows = await tx.$queryRaw<Array<{ startsAt: Date; lessonId: string }>>`
      SELECT startsAt, lessonId FROM class_sessions
      WHERE classId = ${classId} AND status <> 'CANCELLED'
        AND lessonId IN (SELECT id FROM lessons WHERE unitId = ${unitId} AND kind = 'LESSON')
      ORDER BY startsAt DESC, id DESC LIMIT 1 FOR UPDATE`;
    return rows[0] ?? null;
  }
}
