import { Injectable } from '@nestjs/common';
import { Prisma, type SessionStatus } from '@prisma/client';

export type CancelTargetRow = {
  id: string;
  classId: string;
  lessonId: string;
  teacherId: string;
  startsAt: Date;
  endsAt: Date;
  status: SessionStatus;
  revision: number;
};

export type ChainRow = { id: string; classId: string; lessonId: string; startsAt: Date };

const UPDATE_CHUNK = 500;

function lockClause(lock: boolean): Prisma.Sql {
  return lock ? Prisma.sql`FOR UPDATE` : Prisma.empty;
}

/**
 * Row reads and writes of session cancellation that need SQL Prisma cannot express:
 * locking reads (a TiDB pessimistic transaction reads plain SELECTs from its start
 * snapshot, so rows checked after a lock are read with `FOR UPDATE`) and a one-statement
 * lesson update for many sessions.
 */
@Injectable()
export class SessionCancellationRepository {
  async lockClasses(tx: Prisma.TransactionClient, classIds: string[]): Promise<void> {
    const ids = [...new Set(classIds)].sort();
    if (!ids.length) return;
    await tx.$queryRaw`SELECT id FROM classes WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  }

  async sessions(
    tx: Prisma.TransactionClient,
    ids: string[],
    lock: boolean,
  ): Promise<CancelTargetRow[]> {
    if (!ids.length) return [];
    const rows = await tx.$queryRaw<CancelTargetRow[]>`
      SELECT id, classId, lessonId, teacherId, startsAt, endsAt, status, revision
      FROM class_sessions WHERE id IN (${Prisma.join([...new Set(ids)])})
      ORDER BY id ${lockClause(lock)}`;
    return rows.map((row) => ({ ...row, revision: Number(row.revision) }));
  }

  /** Scheduled sessions of the classes starting at or after `from`. */
  async chain(
    tx: Prisma.TransactionClient,
    classIds: string[],
    from: Date,
    lock: boolean,
  ): Promise<ChainRow[]> {
    const ids = [...new Set(classIds)];
    if (!ids.length) return [];
    return tx.$queryRaw<ChainRow[]>`
      SELECT id, classId, lessonId, startsAt FROM class_sessions
      WHERE classId IN (${Prisma.join(ids)}) AND status = 'SCHEDULED' AND startsAt >= ${from}
      ORDER BY id ${lockClause(lock)}`;
  }

  /** Sessions that are the original or the replacement of a booked makeup. */
  async bookedSessionIds(
    tx: Prisma.TransactionClient,
    sessionIds: string[],
    lock: boolean,
  ): Promise<Set<string>> {
    const ids = [...new Set(sessionIds)];
    if (!ids.length) return new Set();
    // One query per side so each join uses its own index (originalParticipantId,
    // replacementParticipantId) instead of an OR that can scan and lock the whole table.
    const [asOriginal, asReplacement] = [
      await tx.$queryRaw<Array<{ sessionId: string }>>`
        SELECT sp.sessionId AS sessionId FROM session_participants sp
        JOIN makeup_bookings mb ON mb.originalParticipantId = sp.id
        WHERE sp.sessionId IN (${Prisma.join(ids)}) AND mb.status = 'BOOKED'
        ${lockClause(lock)}`,
      await tx.$queryRaw<Array<{ sessionId: string }>>`
        SELECT sp.sessionId AS sessionId FROM session_participants sp
        JOIN makeup_bookings mb ON mb.replacementParticipantId = sp.id
        WHERE sp.sessionId IN (${Prisma.join(ids)}) AND mb.status = 'BOOKED'
        ${lockClause(lock)}`,
    ];
    return new Set([...asOriginal, ...asReplacement].map((row) => row.sessionId));
  }

  /**
   * Last session not cancelled of a class that teaches a lesson of the unit, read with a
   * lock so a generation that waited for a concurrent cancel sees that cancel's lessons.
   * The subquery is a plain read: lesson unit and kind do not change once scheduled.
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

  /** Sets each session's lesson and bumps its revision, one statement per chunk. */
  async applyLessons(
    tx: Prisma.TransactionClient,
    updates: Array<{ sessionId: string; lessonId: string }>,
  ): Promise<void> {
    for (let start = 0; start < updates.length; start += UPDATE_CHUNK) {
      const chunk = updates.slice(start, start + UPDATE_CHUNK);
      const cases = Prisma.join(
        chunk.map((row) => Prisma.sql`WHEN ${row.sessionId} THEN ${row.lessonId}`),
        ' ',
      );
      await tx.$executeRaw`
        UPDATE class_sessions
        SET lessonId = CASE id ${cases} END, revision = revision + 1
        WHERE id IN (${Prisma.join(chunk.map((row) => row.sessionId))})`;
    }
  }
}
