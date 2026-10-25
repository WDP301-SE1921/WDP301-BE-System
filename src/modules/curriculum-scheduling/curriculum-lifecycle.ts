import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app.error';

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

export function assertCurriculumSessionDates(
  unit: { fromDate: Date; toDate: Date },
  startsAt: Date,
  endsAt: Date,
): void {
  const start = unit.fromDate.getTime() - VIETNAM_OFFSET_MS;
  const endExclusive = unit.toDate.getTime() + DAY_MS - VIETNAM_OFFSET_MS;
  if (startsAt.getTime() < start || endsAt.getTime() > endExclusive)
    throw new AppError(
      'RANGE_OUTSIDE_UNIT',
      'Session dates are outside the curriculum period',
      HttpStatus.CONFLICT,
    );
}

/** Caller holds the program lock, before any unit/class lock or publication write. */
export async function assertNoCurriculumOverlap(
  tx: Prisma.TransactionClient,
  unit: { id: string; programId: string; fromDate: Date; toDate: Date },
): Promise<void> {
  const conflicts = await tx.curriculumUnit.findMany({
    where: {
      programId: unit.programId,
      id: { not: unit.id },
      fromDate: { lte: unit.toDate },
      toDate: { gte: unit.fromDate },
      ...publishedCurriculumWhere,
    },
    select: { id: true, title: true, fromDate: true, toDate: true },
    orderBy: [{ fromDate: 'asc' }, { id: 'asc' }],
  });
  if (conflicts.length)
    throw new AppError(
      'CURRICULUM_EFFECTIVE_PERIOD_CONFLICT',
      'Another published curriculum covers these dates',
      HttpStatus.CONFLICT,
      { programId: unit.programId, conflicts },
    );
}

/** Reconcile every missed transition using the nearest published successor. */
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
