import { Prisma } from '@prisma/client';

const DAY_MS = 86_400_000;
const VIETNAM_OFFSET_MS = 7 * 3_600_000;

/** Auto-archived publications remain authoritative for their historical period. */
export const publishedCurriculumWhere = {
  OR: [
    { status: 'APPROVED' },
    { status: 'ARCHIVED', archiveReason: 'SUPERSEDED', approvedAt: { not: null } },
  ],
} satisfies Prisma.CurriculumUnitWhereInput;

export function vietnamDate(now = new Date()): string {
  return new Date(now.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
}

export async function lockCurriculumProgram(
  tx: Prisma.TransactionClient,
  programId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM programs WHERE id = ${programId} FOR UPDATE`;
}

/** A version stays in use until the next one is approved (Đợt F, 2026-11-19). */
export const OPEN_PERIOD_END = '2099-12-31';

function vietnamDay(now: Date): Date {
  return new Date(`${vietnamDate(now)}T00:00:00.000Z`);
}

/** Placeholder period of a draft; the real one is set when the manager approves. */
export function draftPeriod(now = new Date()): { fromDate: Date; toDate: Date } {
  return { fromDate: vietnamDay(now), toDate: new Date(`${OPEN_PERIOD_END}T00:00:00.000Z`) };
}

/** An approved version applies from its approval day (Vietnam) until it is replaced. */
export function approvedPeriod(now = new Date()): { fromDate: Date; toDate: Date } {
  return draftPeriod(now);
}

/**
 * Approving a version replaces every other approved version of the program at once. Classes
 * that already teach a replaced version keep it to the last lesson. Caller holds the program
 * lock and runs this before giving the approved version its period.
 */
export async function supersedeOtherCurricula(
  tx: Prisma.TransactionClient,
  approved: { id: string; programId: string },
  actorUserId: string,
  now = new Date(),
): Promise<void> {
  const yesterday = new Date(vietnamDay(now).getTime() - DAY_MS);
  const others = await tx.curriculumUnit.findMany({
    where: { programId: approved.programId, id: { not: approved.id }, status: 'APPROVED' },
    select: { id: true, fromDate: true },
    orderBy: [{ fromDate: 'asc' }, { id: 'asc' }],
  });
  for (const unit of others) {
    // Its period ends the day before the replacement; never before the day it started.
    const toDate = unit.fromDate > yesterday ? unit.fromDate : yesterday;
    await tx.curriculumUnit.update({
      where: { id: unit.id },
      data: {
        status: 'ARCHIVED',
        archivedAt: now,
        archiveReason: 'SUPERSEDED',
        supersededById: approved.id,
        toDate,
        revision: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: 'CURRICULUM_UNIT_AUTO_ARCHIVED',
        entityType: 'CurriculumUnit',
        entityId: unit.id,
        beforeData: { status: 'APPROVED' },
        afterData: {
          status: 'ARCHIVED',
          archiveReason: 'SUPERSEDED',
          supersededById: approved.id,
          archivedAt: now.toISOString(),
          toDate: toDate.toISOString().slice(0, 10),
          triggeredBy: 'APPROVAL',
        },
      },
    });
  }
}

/**
 * Legacy data only: units approved before Đợt F carry hand-typed periods. Reconcile every
 * missed transition using the nearest published successor.
 */
export async function archiveSupersededCurricula(
  tx: Prisma.TransactionClient,
  programId: string,
  now = new Date(),
): Promise<void> {
  const units = await tx.curriculumUnit.findMany({
    where: { programId, ...publishedCurriculumWhere },
    select: {
      id: true,
      status: true,
      fromDate: true,
      toDate: true,
      designerId: true,
      reviewedById: true,
      approvedAt: true,
    },
    orderBy: [{ fromDate: 'asc' }, { id: 'asc' }],
  });
  const today = new Date(`${vietnamDate(now)}T00:00:00.000Z`);
  for (const unit of units) {
    if (unit.status !== 'APPROVED') continue;
    const successor = units.find(
      (candidate) => candidate.fromDate > unit.toDate && candidate.fromDate <= today,
    );
    if (!successor) continue;
    const changed = await tx.curriculumUnit.updateMany({
      where: { id: unit.id, status: 'APPROVED' },
      data: {
        status: 'ARCHIVED',
        archivedAt: now,
        archiveReason: 'SUPERSEDED',
        supersededById: successor.id,
        revision: { increment: 1 },
      },
    });
    if (!changed.count) continue;
    await tx.auditLog.create({
      data: {
        actorUserId: successor.reviewedById ?? successor.designerId,
        action: 'CURRICULUM_UNIT_AUTO_ARCHIVED',
        entityType: 'CurriculumUnit',
        entityId: unit.id,
        beforeData: { status: 'APPROVED' },
        afterData: {
          status: 'ARCHIVED',
          archiveReason: 'SUPERSEDED',
          supersededById: successor.id,
          archivedAt: now.toISOString(),
          triggeredBy: 'SYSTEM',
        },
      },
    });
  }
}
