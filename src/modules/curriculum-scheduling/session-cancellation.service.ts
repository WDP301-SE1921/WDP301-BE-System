import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors/app.error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { DatabaseService } from '../../database/orm/database.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { closuresBetween } from './center-closure.service';
import type {
  SessionBulkCancelDto,
  SessionBulkCancelPreviewDto,
  SessionCancelDto,
  SessionCancelPreviewDto,
} from './curriculum-scheduling.dto';
import {
  SessionCancellationRepository,
  type CancelTargetRow,
  type ChainRow,
} from './session-cancellation.repository';
import { compactLessons, slotsForRange, vietnamDate } from './session-lesson-plan';

export type CancelBlockerCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_LOCKED'
  | 'MAKEUP_BOOKING_EXISTS'
  | 'ATTENDANCE_RECORDED'
  | 'LEAVE_EXISTS'
  | 'LESSON_SHIFT_BLOCKED';

export type CancelBlocker = { sessionId: string; code: CancelBlockerCode };

type LessonRef = { id: string; title: string };
type LessonInfo = LessonRef & { sequence: number; kind: string; unitId: string | null };

export type ShiftedSession = {
  sessionId: string;
  startsAt: Date;
  fromLesson: LessonRef;
  toLesson: LessonRef;
  hasAssessments: boolean;
};

export type PushedLesson = LessonRef & { sequence: number; fitsInTerm: boolean };

export type ClassCancellation = {
  classId: string;
  className: string;
  cancelledSessions: Array<{ id: string; startsAt: Date; endsAt: Date; lesson: LessonRef }>;
  shiftedSessions: ShiftedSession[];
  pushedLessons: PushedLesson[];
};

type ShiftGroup = {
  classId: string;
  unitId: string;
  cancelledIds: string[];
  changes: Array<{ sessionId: string; fromLessonId: string; toLessonId: string }>;
  pushedLessonIds: string[];
};

type Evaluation = {
  targets: CancelTargetRow[];
  blockers: CancelBlocker[];
  cancellable: CancelTargetRow[];
  classes: ClassCancellation[];
  groups: ShiftGroup[];
  updates: Array<{ sessionId: string; lessonId: string }>;
};

const BULK_TIMEOUT_MS = 60_000;

/**
 * Session cancellation that moves lessons (B6): single cancel with `shiftLessons`, the
 * previews and bulk cancel. Cancelling without moving lessons stays in
 * `CurriculumSchedulingService.cancelSession`, unchanged.
 */
@Injectable()
export class SessionCancellationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationEventsService,
    private readonly repo: SessionCancellationRepository,
  ) {}

  async cancelWithShift(
    user: AuthenticatedUser,
    id: string,
    input: SessionCancelDto,
    key: string | undefined,
  ): Promise<unknown> {
    this.requireManager(user);
    const idempotencyKey = this.requireKey(key);
    // Same hash as the plain cancel plus the flag, so one key cannot serve both modes.
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          actorId: user.id,
          action: 'cancel',
          id,
          reason: input.reason,
          expectedRevision: input.expectedRevision,
          shiftLessons: true,
        }),
      )
      .digest('hex');
    const hint = await this.db.classSession.findUnique({
      where: { id },
      select: { classId: true },
    });
    this.assert(hint, 'SESSION_NOT_FOUND', 'Session not found', HttpStatus.NOT_FOUND);
    return this.transaction(async (tx) => {
      // Class first, then sessions: the order generate and bulk cancel use as well.
      await this.repo.lockClasses(tx, [hint.classId]);
      await this.repo.sessions(tx, [id], true);
      const prior = await tx.sessionMutation.findUnique({
        where: { sessionId_key: { sessionId: id, key: idempotencyKey } },
      });
      if (prior) {
        this.assert(
          prior.actorUserId === user.id && prior.requestHash === hash,
          'IDEMPOTENCY_CONFLICT',
          'Key was used for another change',
        );
        return prior.response;
      }
      const evaluation = await this.evaluate(tx, [id], true, true);
      const target = evaluation.targets[0];
      this.assert(target, 'SESSION_NOT_FOUND', 'Session not found', HttpStatus.NOT_FOUND);
      const codes = new Set(
        evaluation.blockers.filter((row) => row.sessionId === id).map((row) => row.code),
      );
      // Same checks, codes and order as the plain cancel.
      this.assert(
        !codes.has('SESSION_LOCKED'),
        'SESSION_LOCKED',
        'Only future scheduled sessions can be cancelled',
      );
      this.assert(
        target.revision === input.expectedRevision,
        'REVISION_CONFLICT',
        'Session changed; reload it',
      );
      this.assert(
        !codes.has('MAKEUP_BOOKING_EXISTS'),
        'MAKEUP_BOOKING_EXISTS',
        'Resolve makeup bookings before cancelling',
      );
      this.assert(
        !codes.has('ATTENDANCE_RECORDED') && !codes.has('LEAVE_EXISTS'),
        'SESSION_HAS_DEPENDENCIES',
        'Resolve attendance and leave records before cancelling',
      );
      this.assertShiftAllowed(evaluation);
      const reason = input.reason.trim();
      await this.apply(tx, user, evaluation, reason, true);
      const session = await tx.classSession.findUniqueOrThrow({ where: { id } });
      const outcome = evaluation.classes[0];
      const pushed = outcome?.pushedLessons[0] ?? null;
      const response = toJson({
        ...session,
        shiftedSessions: outcome?.shiftedSessions ?? [],
        pushedLesson: pushed && { id: pushed.id, title: pushed.title, sequence: pushed.sequence },
        pushedLessonFits: pushed?.fitsInTerm ?? false,
      });
      await tx.sessionMutation.create({
        data: {
          sessionId: id,
          actorUserId: user.id,
          key: idempotencyKey,
          requestHash: hash,
          response,
        },
      });
      await this.notifications.session(
        tx,
        user.id,
        id,
        'SESSION_CANCELLED',
        `Buổi học đã bị huỷ: ${reason}${outcome?.shiftedSessions.length ? '. Bài học của các buổi sau lùi một buổi.' : ''}`,
        `cancel:${id}:${idempotencyKey}`,
      );
      return response;
    });
  }

  async cancelPreview(
    user: AuthenticatedUser,
    id: string,
    input: SessionCancelPreviewDto,
  ): Promise<unknown> {
    this.requireManager(user);
    const shiftLessons = input.shiftLessons === true;
    const evaluation = await this.evaluate(this.db, [id], shiftLessons, false);
    const target = evaluation.targets[0];
    this.assert(target, 'SESSION_NOT_FOUND', 'Session not found', HttpStatus.NOT_FOUND);
    const outcome = evaluation.classes[0];
    const pushed = outcome?.pushedLessons[0] ?? null;
    return {
      sessionId: id,
      classId: target.classId,
      shiftLessons,
      cancellable: !evaluation.blockers.length,
      blockers: evaluation.blockers,
      shiftedSessions: outcome?.shiftedSessions ?? [],
      pushedLesson: pushed && { id: pushed.id, title: pushed.title, sequence: pushed.sequence },
      pushedLessonFits: pushed?.fitsInTerm ?? false,
    };
  }

  async bulkCancelPreview(
    user: AuthenticatedUser,
    input: SessionBulkCancelPreviewDto,
  ): Promise<unknown> {
    this.requireManager(user);
    const shiftLessons = input.shiftLessons === true;
    const evaluation = await this.evaluate(this.db, input.sessionIds, shiftLessons, false);
    return {
      total: input.sessionIds.length,
      shiftLessons,
      cancellable: !evaluation.blockers.length,
      blockers: evaluation.blockers,
      classes: evaluation.classes,
    };
  }

  async bulkCancel(
    user: AuthenticatedUser,
    input: SessionBulkCancelDto,
    key: string | undefined,
  ): Promise<unknown> {
    this.requireManager(user);
    const idempotencyKey = this.requireKey(key);
    const shiftLessons = input.shiftLessons === true;
    const reason = input.reason.trim();
    const sessionIds = [...new Set(input.sessionIds)].sort();
    const hash = createHash('sha256')
      .update(JSON.stringify({ action: 'bulk-cancel', sessionIds, reason, shiftLessons }))
      .digest('hex');
    const hints = await this.db.classSession.findMany({
      where: { id: { in: sessionIds } },
      select: { classId: true },
    });
    return this.transaction(async (tx) => {
      await this.repo.lockClasses(
        tx,
        hints.map((row) => row.classId),
      );
      const prior = await tx.sessionBulkCancel.findUnique({
        where: { actorUserId_key: { actorUserId: user.id, key: idempotencyKey } },
      });
      if (prior) {
        this.assert(
          prior.requestHash === hash,
          'IDEMPOTENCY_CONFLICT',
          'Key was used with a different request',
        );
        return prior.response;
      }
      const evaluation = await this.evaluate(tx, sessionIds, shiftLessons, true);
      if (evaluation.blockers.length)
        throw new AppError(
          'BULK_CANCEL_BLOCKED',
          'Some sessions cannot be cancelled',
          HttpStatus.CONFLICT,
          { blockers: evaluation.blockers },
        );
      const bulkId = randomUUID();
      await this.apply(tx, user, evaluation, reason, shiftLessons, bulkId);
      const response = toJson({
        bulkId,
        cancelledCount: evaluation.cancellable.length,
        shiftLessons,
        classes: evaluation.classes,
      });
      await tx.sessionBulkCancel.create({
        data: {
          id: bulkId,
          actorUserId: user.id,
          key: idempotencyKey,
          requestHash: hash,
          response,
        },
      });
      // One notification per class, not one per session (C5).
      for (const outcome of evaluation.classes) {
        const cancelled = evaluation.cancellable.filter((row) => row.classId === outcome.classId);
        const dates = cancelled.map((row) => shortDate(row.startsAt));
        const listed = dates.length > 10 ? `${dates.slice(0, 10).join(', ')}…` : dates.join(', ');
        await this.notifications.send(
          tx,
          user.id,
          'SESSION_CANCELLED',
          'CLASS',
          outcome.classId,
          'Cập nhật lịch học',
          `Lớp ${outcome.className}: huỷ ${cancelled.length} buổi (${listed}). Lý do: ${reason}.${outcome.shiftedSessions.length ? ' Bài học của các buổi sau được dời lùi.' : ''}`,
          await this.notifications.recipients.sessions(tx, cancelled),
          outcome.classId,
          `bulk-cancel:${bulkId}:${outcome.classId}`,
        );
      }
      return response;
    }, BULK_TIMEOUT_MS);
  }

  /**
   * Checks and lesson moves shared by the previews and the real commands. Pure read: the
   * caller writes. `lock` reads the rows with `FOR UPDATE` inside the caller's transaction.
   */
  private async evaluate(
    tx: Prisma.TransactionClient,
    sessionIds: string[],
    shiftLessons: boolean,
    lock: boolean,
  ): Promise<Evaluation> {
    const now = new Date();
    const targets = await this.repo.sessions(tx, sessionIds, lock);
    const byId = new Map(targets.map((row) => [row.id, row]));
    const blockers: CancelBlocker[] = [];
    const open = targets.filter((row) => row.status === 'SCHEDULED' && row.startsAt > now);
    const openIds = open.map((row) => row.id);
    const [booked, attendance, leaves] = await Promise.all([
      this.repo.bookedSessionIds(tx, openIds, lock),
      openIds.length
        ? tx.sessionParticipant.findMany({
            where: { sessionId: { in: openIds }, attendance: { not: 'UNMARKED' } },
            select: { sessionId: true },
          })
        : [],
      openIds.length
        ? tx.leaveRequest.findMany({
            where: { sessionId: { in: openIds }, status: { in: ['PENDING', 'APPROVED'] } },
            select: { sessionId: true },
          })
        : [],
    ]);
    const attended = new Set(attendance.map((row) => row.sessionId));
    const onLeave = new Set(leaves.map((row) => row.sessionId));
    const cancellable: CancelTargetRow[] = [];
    for (const id of [...new Set(sessionIds)]) {
      const row = byId.get(id);
      const code: CancelBlockerCode | null = !row
        ? 'SESSION_NOT_FOUND'
        : row.status !== 'SCHEDULED' || row.startsAt <= now
          ? 'SESSION_LOCKED'
          : booked.has(id)
            ? 'MAKEUP_BOOKING_EXISTS'
            : attended.has(id)
              ? 'ATTENDANCE_RECORDED'
              : onLeave.has(id)
                ? 'LEAVE_EXISTS'
                : null;
      if (code) blockers.push({ sessionId: id, code });
      else cancellable.push(row!);
    }
    const lessons = await this.lessons(
      tx,
      cancellable.map((row) => row.lessonId),
    );
    const groups: ShiftGroup[] = [];
    const unitless: CancelTargetRow[] = [];
    let chain: ChainRow[] = [];
    if (shiftLessons && cancellable.length) {
      for (const row of cancellable) {
        const lesson = lessons.get(row.lessonId);
        if (!lesson?.unitId || lesson.kind !== 'LESSON') {
          unitless.push(row);
          continue;
        }
        const group = groups.find(
          (item) => item.classId === row.classId && item.unitId === lesson.unitId,
        );
        if (group) group.cancelledIds.push(row.id);
        else
          groups.push({
            classId: row.classId,
            unitId: lesson.unitId,
            cancelledIds: [row.id],
            changes: [],
            pushedLessonIds: [],
          });
      }
      if (groups.length) {
        const earliest = new Date(
          Math.min(
            ...cancellable
              .filter((row) => !unitless.includes(row))
              .map((row) => row.startsAt.getTime()),
          ),
        );
        chain = await this.repo.chain(
          tx,
          groups.map((group) => group.classId),
          earliest,
          lock,
        );
        for (const [id, info] of await this.lessons(
          tx,
          chain.map((row) => row.lessonId),
        ))
          lessons.set(id, info);
      }
      for (const group of groups) {
        const cancelled = new Set(group.cancelledIds);
        const members = new Map<string, ChainRow>();
        for (const row of [...chain, ...cancellable]) {
          const info = lessons.get(row.lessonId);
          if (
            row.classId === group.classId &&
            info?.unitId === group.unitId &&
            info.kind === 'LESSON'
          )
            members.set(row.id, {
              id: row.id,
              classId: row.classId,
              lessonId: row.lessonId,
              startsAt: row.startsAt,
            });
        }
        const shift = compactLessons([...members.values()], cancelled);
        group.changes = shift.changes;
        group.pushedLessonIds = shift.pushedLessonIds;
      }
    }
    const updates = groups.flatMap((group) =>
      group.changes.map((change) => ({ sessionId: change.sessionId, lessonId: change.toLessonId })),
    );
    const changedIds = updates.map((row) => row.sessionId);
    const [shiftBooked, assessed] = await Promise.all([
      this.repo.bookedSessionIds(tx, changedIds, lock),
      changedIds.length
        ? tx.assignment.findMany({
            where: { sessionId: { in: changedIds } },
            select: { sessionId: true },
          })
        : [],
    ]);
    // SRS 5.6: a makeup must study the same lesson, so a booked session keeps its lesson.
    for (const id of changedIds)
      if (shiftBooked.has(id)) blockers.push({ sessionId: id, code: 'LESSON_SHIFT_BLOCKED' });
    const withAssessments = new Set(
      assessed.flatMap((row) => (row.sessionId ? [row.sessionId] : [])),
    );
    const classes = await this.describe(tx, {
      cancellable,
      chain,
      groups,
      unitless,
      lessons,
      withAssessments,
      now,
    });
    return { targets, blockers, cancellable, classes, groups, updates };
  }

  private async describe(
    tx: Prisma.TransactionClient,
    input: {
      cancellable: CancelTargetRow[];
      chain: ChainRow[];
      groups: ShiftGroup[];
      unitless: CancelTargetRow[];
      lessons: Map<string, LessonInfo>;
      withAssessments: Set<string>;
      now: Date;
    },
  ): Promise<ClassCancellation[]> {
    const { cancellable, chain, groups, unitless, lessons, withAssessments, now } = input;
    const classIds = [...new Set(cancellable.map((row) => row.classId))];
    if (!classIds.length) return [];
    const unitIds = [...new Set(groups.map((group) => group.unitId))];
    const [classes, units] = await Promise.all([
      tx.class.findMany({
        where: { id: { in: classIds } },
        select: {
          id: true,
          name: true,
          weeklySchedules: { select: { weekday: true, startTime: true, endTime: true } },
        },
      }),
      unitIds.length
        ? tx.curriculumUnit.findMany({
            where: { id: { in: unitIds } },
            select: { id: true, fromDate: true, toDate: true },
          })
        : [],
    ]);
    const closures = units.length
      ? await closuresBetween(
          tx,
          isoDate(new Date(Math.min(...units.map((unit) => unit.fromDate.getTime())))),
          isoDate(new Date(Math.max(...units.map((unit) => unit.toDate.getTime())))),
        )
      : [];
    const ref = (lessonId: string): LessonRef => {
      const info = lessons.get(lessonId);
      return { id: lessonId, title: info?.title ?? '' };
    };
    const startsOf = new Map(
      [...chain, ...cancellable].map((row) => [row.id, row.startsAt] as [string, Date]),
    );
    const result: ClassCancellation[] = [];
    for (const classId of classIds) {
      const classroom = classes.find((row) => row.id === classId);
      const shiftedSessions: ShiftedSession[] = [];
      const pushedLessons: PushedLesson[] = [];
      for (const group of groups.filter((item) => item.classId === classId)) {
        for (const change of group.changes)
          shiftedSessions.push({
            sessionId: change.sessionId,
            startsAt: startsOf.get(change.sessionId)!,
            fromLesson: ref(change.fromLessonId),
            toLesson: ref(change.toLessonId),
            hasAssessments: withAssessments.has(change.sessionId),
          });
        const unit = units.find((row) => row.id === group.unitId);
        const room = await this.slotsLeft(tx, group, chain, lessons, {
          schedules: classroom?.weeklySchedules ?? [],
          unit,
          closures,
          now,
        });
        group.pushedLessonIds.forEach((lessonId, index) => {
          const info = lessons.get(lessonId);
          pushedLessons.push({
            ...ref(lessonId),
            sequence: info?.sequence ?? 0,
            fitsInTerm: index < room,
          });
        });
      }
      // A lesson outside any curriculum is never generated again, so it has no slot.
      for (const row of unitless.filter((item) => item.classId === classId)) {
        const info = lessons.get(row.lessonId);
        pushedLessons.push({
          ...ref(row.lessonId),
          sequence: info?.sequence ?? 0,
          fitsInTerm: false,
        });
      }
      shiftedSessions.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      result.push({
        classId,
        className: classroom?.name ?? '',
        cancelledSessions: cancellable
          .filter((row) => row.classId === classId)
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
          .map((row) => ({
            id: row.id,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            lesson: ref(row.lessonId),
          })),
        shiftedSessions,
        pushedLessons,
      });
    }
    return result;
  }

  /**
   * Weekly slots of the term left after the class's last session of this curriculum once
   * the cancellation is applied: the next generation starts with the pushed lessons there.
   */
  private async slotsLeft(
    tx: Prisma.TransactionClient,
    group: ShiftGroup,
    chain: ChainRow[],
    lessons: Map<string, LessonInfo>,
    context: {
      schedules: Array<{ weekday: number; startTime: string; endTime: string }>;
      unit: { fromDate: Date; toDate: Date } | undefined;
      closures: Array<{ fromDate: string; toDate: string }>;
      now: Date;
    },
  ): Promise<number> {
    if (!context.unit) return 0;
    const cancelled = new Set(group.cancelledIds);
    const survivors = chain.filter(
      (row) =>
        row.classId === group.classId &&
        !cancelled.has(row.id) &&
        lessons.get(row.lessonId)?.unitId === group.unitId &&
        lessons.get(row.lessonId)?.kind === 'LESSON',
    );
    let last: Date | null = survivors.length
      ? new Date(Math.max(...survivors.map((row) => row.startsAt.getTime())))
      : null;
    if (!last) {
      const before = await tx.classSession.findFirst({
        where: {
          classId: group.classId,
          status: { not: 'CANCELLED' },
          id: { notIn: group.cancelledIds },
          lesson: { unitId: group.unitId, kind: 'LESSON' },
        },
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
        select: { startsAt: true },
      });
      last = before?.startsAt ?? null;
    }
    const after = last ?? context.now;
    return slotsForRange(
      context.schedules,
      last ? vietnamDate(last) : isoDate(context.unit.fromDate),
      isoDate(context.unit.toDate),
      context.closures,
    ).filter((slot) => slot.startsAt > after).length;
  }

  private async apply(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    evaluation: Evaluation,
    reason: string,
    shiftLessons: boolean,
    bulkId?: string,
  ): Promise<void> {
    const ids = evaluation.cancellable.map((row) => row.id);
    await tx.classSession.updateMany({
      where: { id: { in: ids }, status: 'SCHEDULED' },
      data: {
        status: 'CANCELLED',
        cancelReason: reason,
        cancelledAt: new Date(),
        revision: { increment: 1 },
      },
    });
    await this.repo.applyLessons(tx, evaluation.updates);
    await tx.auditLog.createMany({
      data: [
        ...ids.map((id) => ({
          actorUserId: user.id,
          action: 'CLASS_SESSION_CANCELLED',
          entityType: 'ClassSession',
          entityId: id,
          afterData: { reason, shiftLessons, ...(bulkId ? { bulkId } : {}) },
        })),
        ...evaluation.groups
          .filter((group) => group.changes.length || group.pushedLessonIds.length)
          .map((group) => ({
            actorUserId: user.id,
            action: 'CLASS_SESSION_LESSONS_SHIFTED',
            entityType: 'Class',
            entityId: group.classId,
            beforeData: {
              unitId: group.unitId,
              sessions: group.changes.map((row) => ({
                sessionId: row.sessionId,
                lessonId: row.fromLessonId,
              })),
            },
            afterData: {
              unitId: group.unitId,
              cancelledSessionIds: group.cancelledIds,
              sessions: group.changes.map((row) => ({
                sessionId: row.sessionId,
                lessonId: row.toLessonId,
              })),
              pushedLessonIds: group.pushedLessonIds,
              ...(bulkId ? { bulkId } : {}),
            },
          })),
      ],
    });
  }

  private assertShiftAllowed(evaluation: Evaluation): void {
    const blocked = evaluation.blockers.filter((row) => row.code === 'LESSON_SHIFT_BLOCKED');
    if (!blocked.length) return;
    const startsOf = new Map(
      evaluation.classes.flatMap((item) =>
        item.shiftedSessions.map((row) => [row.sessionId, row.startsAt] as [string, Date]),
      ),
    );
    throw new AppError(
      'LESSON_SHIFT_BLOCKED',
      'A later session has a booked makeup for its current lesson',
      HttpStatus.CONFLICT,
      {
        sessions: blocked.map((row) => ({
          sessionId: row.sessionId,
          startsAt: startsOf.get(row.sessionId) ?? null,
        })),
      },
    );
  }

  private async lessons(
    tx: Prisma.TransactionClient,
    ids: string[],
  ): Promise<Map<string, LessonInfo>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await tx.lesson.findMany({
      where: { id: { in: unique } },
      select: { id: true, title: true, sequence: true, kind: true, unitId: true },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private requireManager(user: AuthenticatedUser): void {
    this.assert(user.role === 'MANAGER', 'FORBIDDEN', 'Role is not allowed', HttpStatus.FORBIDDEN);
  }

  private requireKey(key: string | undefined): string {
    const idempotencyKey = key?.trim();
    this.assert(
      idempotencyKey && idempotencyKey.length <= 191,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key is required',
      HttpStatus.BAD_REQUEST,
    );
    return idempotencyKey;
  }

  private assert(
    condition: unknown,
    code: string,
    message: string,
    status = HttpStatus.CONFLICT,
  ): asserts condition {
    if (!condition) throw new AppError(code, message, status);
  }

  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    timeout = 20_000,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(work, { isolationLevel: 'RepeatableRead', timeout });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 2
        )
          continue;
        throw error;
      }
    }
  }
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shortDate(value: Date): string {
  const [, month, day] = vietnamDate(value).split('-');
  return `${day}/${month}`;
}

/** Plain JSON copy: what the client gets now is what a replay of the same key returns. */
function toJson<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
