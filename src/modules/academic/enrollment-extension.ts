import { HttpStatus } from '@nestjs/common';
import type { EnrollmentExtension, ExtensionSource, Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app.error';
import { studyDate } from './academic-access.service';

/** A long leave of at least this many days may be credited back to the term (bảo lưu). */
export const MIN_PAUSE_DAYS_FOR_EXTENSION = 14;
export const MAX_EXTENSION_DAYS = 90;

const DAY_MS = 86_400_000;

/** Days of an inclusive local date range (both stored as UTC midnight). */
export function inclusiveDays(fromDate: Date, toDate: Date): number {
  return Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1;
}

/**
 * Days to add to an exclusive term end so it covers one more class day: the first study weekday on
 * or after `endDate` becomes the last day of the term.
 */
export function daysForOneMoreSession(endDate: Date, weekdays: readonly number[]): number {
  for (let offset = 0; offset < 14; offset++) {
    const day = new Date(endDate.getTime() + offset * DAY_MS);
    const isoWeekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    if (weekdays.includes(isoWeekday)) return offset + 1;
  }
  return 7;
}

export interface ExtendInput {
  enrollmentId: string;
  source: ExtensionSource;
  days: number;
  reason: string;
  actorUserId: string;
  leaveRequestId?: string;
  sessionId?: string;
}

/**
 * Pushes the enrollment end date by `days`, records why, and audits it. The bill is unchanged and
 * class capacity is not checked: the family already paid, or the center caused the loss.
 * Returns null instead of throwing when `skipIfNotExtendable` and the enrollment is not active.
 */
export async function extendEnrollment(
  tx: Prisma.TransactionClient,
  input: ExtendInput,
  options: { skipIfNotExtendable?: boolean } = {},
): Promise<EnrollmentExtension | null> {
  await tx.$queryRaw`SELECT id FROM enrollments WHERE id = ${input.enrollmentId} FOR UPDATE`;
  const enrollment = await tx.enrollment.findUnique({ where: { id: input.enrollmentId } });
  if (!enrollment || enrollment.status !== 'ACTIVE' || !enrollment.endDate) {
    if (options.skipIfNotExtendable) return null;
    throw new AppError(
      'ENROLLMENT_NOT_EXTENDABLE',
      'Only an active enrollment with an end date can be extended',
      HttpStatus.CONFLICT,
    );
  }
  if (input.days < 1 || input.days > MAX_EXTENSION_DAYS)
    throw new AppError(
      'INVALID_EXTENSION_DAYS',
      `Extend by 1-${MAX_EXTENSION_DAYS} days`,
      HttpStatus.BAD_REQUEST,
    );
  const previousEndDate = enrollment.endDate;
  const newEndDate = new Date(previousEndDate.getTime() + input.days * DAY_MS);
  await tx.enrollment.update({ where: { id: enrollment.id }, data: { endDate: newEndDate } });
  const extension = await tx.enrollmentExtension.create({
    data: {
      enrollmentId: enrollment.id,
      source: input.source,
      days: input.days,
      reason: input.reason.trim().slice(0, 300),
      leaveRequestId: input.leaveRequestId ?? null,
      sessionId: input.sessionId ?? null,
      previousEndDate,
      newEndDate,
      actorUserId: input.actorUserId,
    },
  });
  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: 'ENROLLMENT_EXTEND',
      entityType: 'Enrollment',
      entityId: enrollment.id,
      beforeData: { endDate: previousEndDate.toISOString().slice(0, 10) },
      afterData: {
        endDate: newEndDate.toISOString().slice(0, 10),
        days: input.days,
        source: input.source,
        reason: extension.reason,
      },
    },
  });
  return extension;
}

/**
 * After a credited leave is shortened or cancelled, keep only the days really missed; below the
 * minimum the credit is removed. Returns the change in days (negative when the term shrinks).
 */
export async function resizeLeaveExtension(
  tx: Prisma.TransactionClient,
  leaveRequestId: string,
  missedDays: number,
  actorUserId: string,
): Promise<number> {
  const extension = await tx.enrollmentExtension.findUnique({ where: { leaveRequestId } });
  if (!extension) return 0;
  const keep = missedDays >= MIN_PAUSE_DAYS_FOR_EXTENSION ? missedDays : 0;
  const delta = keep - extension.days;
  if (!delta) return 0;
  await tx.$queryRaw`SELECT id FROM enrollments WHERE id = ${extension.enrollmentId} FOR UPDATE`;
  const enrollment = await tx.enrollment.findUniqueOrThrow({ where: { id: extension.enrollmentId } });
  if (enrollment.endDate) {
    const endDate = new Date(enrollment.endDate.getTime() + delta * DAY_MS);
    await tx.enrollment.update({ where: { id: enrollment.id }, data: { endDate } });
    if (keep)
      await tx.enrollmentExtension.update({
        where: { id: extension.id },
        data: { days: keep, newEndDate: new Date(extension.newEndDate.getTime() + delta * DAY_MS) },
      });
    else await tx.enrollmentExtension.delete({ where: { id: extension.id } });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: 'ENROLLMENT_EXTEND_CHANGED',
        entityType: 'Enrollment',
        entityId: enrollment.id,
        beforeData: { endDate: enrollment.endDate.toISOString().slice(0, 10), days: extension.days },
        afterData: { endDate: endDate.toISOString().slice(0, 10), days: keep, leaveRequestId },
      },
    });
  }
  return delta;
}

/**
 * Center cancelled sessions without moving them to another day: every student who was due to attend
 * (active, placed in the class, not on an approved pause that day) gets one more class day.
 * Returns how many enrollments were extended.
 */
export async function extendForCancelledSessions(
  tx: Prisma.TransactionClient,
  sessionIds: readonly string[],
  actorUserId: string,
  reason: string,
): Promise<number> {
  if (!sessionIds.length) return 0;
  const sessions = await tx.classSession.findMany({
    where: { id: { in: [...sessionIds] } },
    include: { class: { include: { weeklySchedules: true } } },
  });
  let extended = 0;
  for (const session of sessions) {
    const day = studyDate(session.startsAt);
    const weekdays = session.class.weeklySchedules.map((slot) => slot.weekday);
    const enrollments = await tx.enrollment.findMany({
      where: {
        status: 'ACTIVE',
        studentProfileId: { not: null },
        startDate: { lte: day },
        endDate: { gt: day },
        OR: [
          {
            placements: {
              some: {
                classId: session.classId,
                effectiveFrom: { lte: session.startsAt },
                OR: [{ effectiveTo: null }, { effectiveTo: { gt: session.startsAt } }],
              },
            },
          },
          { placements: { none: {} }, classId: session.classId },
        ],
        leaveRequests: {
          none: {
            status: 'APPROVED',
            kind: 'PERIOD_PAUSE',
            fromDate: { lte: day },
            toDate: { gte: day },
          },
        },
        extensions: { none: { sessionId: session.id } },
      },
      select: { id: true, endDate: true },
    });
    for (const enrollment of enrollments) {
      const done = await extendEnrollment(
        tx,
        {
          enrollmentId: enrollment.id,
          source: 'SESSION_CANCELLED',
          days: daysForOneMoreSession(enrollment.endDate!, weekdays),
          reason,
          actorUserId,
          sessionId: session.id,
        },
        { skipIfNotExtendable: true },
      );
      if (done) extended += 1;
    }
  }
  return extended;
}
