import { Prisma, type PrismaClient } from '@prisma/client';
import { TET_BREAKS } from '../../common/lunar-new-year';
import { peakOccupancy } from '../../modules/registration-flow/registration-flow.service';
import { priceTuition } from '../../modules/registration-flow/tuition-pricing';
import { CURRICULUM_EDITION, TOPICS, lessonContent } from './curriculum-content';
import {
  DEMO_PREFIX,
  addDays,
  demoId,
  localInstant,
  referenceDate,
  studyDay,
} from './seed-calendar';
import { BULK_PREFIX } from './seed-dashboard';
import {
  DASHBOARD_MANIFEST_ID,
  DASHBOARD_SEED_VERSION,
  DEMO_SEED_VERSION,
  manifestData,
} from './seed-manifest';
import { findMakeupTarget, isSeedHoliday } from './seed-makeup';

type RepairDb = Prisma.TransactionClient;
interface Change {
  kind: 'CLASS' | 'LESSON_CLOS' | 'DRAFT_PRICE' | 'MAKEUP_SESSION' | 'HISTORY_UNIT' | 'MANIFEST';
  id: string;
  before: Prisma.InputJsonObject;
  after: Prisma.InputJsonObject;
}
export interface SeedRepairFinding {
  code: string;
  id: string;
  disposition: 'preserve' | 'blocked';
  message: string;
}
export interface SeedRepairPlan {
  referenceDate: string;
  actions: Change[];
  findings: SeedRepairFinding[];
  compatible: boolean;
}

const owned = { OR: [DEMO_PREFIX, BULK_PREFIX].map((prefix) => ({ id: { startsWith: prefix } })) };
const json = (value: unknown): Prisma.InputJsonObject =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;

function repairString(data: Prisma.InputJsonObject, key: string): string {
  const value = data[key];
  if (typeof value !== 'string') throw new Error(`Invalid repair string: ${key}`);
  return value;
}

function repairInteger(data: Prisma.InputJsonObject, key: string): number {
  const value = data[key];
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new Error(`Invalid repair integer: ${key}`);
  return value;
}

function repairIds(data: Prisma.InputJsonObject): string[] {
  const value = data.outcomeIds;
  if (!Array.isArray(value) || !value.every((id): id is string => typeof id === 'string'))
    throw new Error('Invalid repair CLO IDs');
  return value;
}

/** Read-only preview. No re-pricing of confirmed bills, rewriting of completed sessions or reset. */
export async function planSeedRepairs(db: RepairDb, now = new Date()): Promise<SeedRepairPlan> {
  const demo = await db.auditLog.findUnique({ where: { id: demoId('manifest') } });
  if (!demo)
    throw new Error('No completed demo seed found. Use pnpm seed on a development database.');
  const stored = manifestData(demo.afterData);
  const plan: SeedRepairPlan = {
    referenceDate: typeof stored.referenceDate === 'string' ? stored.referenceDate : '',
    actions: [],
    findings: [],
    compatible: true,
  };
  const finding = (
    code: string,
    id: string,
    disposition: 'preserve' | 'blocked',
    message: string,
  ): void => {
    plan.findings.push({ code, id, disposition, message });
    if (disposition === 'blocked') plan.compatible = false;
  };
  if (
    stored.curriculumEdition !== CURRICULUM_EDITION ||
    ![2, DEMO_SEED_VERSION].includes(Number(stored.version))
  ) {
    finding(
      'INCOMPATIBLE_EDITION',
      demo.id,
      'blocked',
      'Preview pnpm db:seed:curriculum for additive drafts, or use a fresh development database. Existing curricula are preserved.',
    );
    return plan;
  }
  referenceDate(plan.referenceDate);
  const dashboard = await db.auditLog.findUnique({ where: { id: DASHBOARD_MANIFEST_ID } });
  const bulk = manifestData(dashboard?.afterData ?? null);
  if (
    dashboard &&
    (![1, DASHBOARD_SEED_VERSION].includes(Number(bulk.version)) ||
      bulk.referenceDate !== plan.referenceDate ||
      (bulk.curriculumEdition !== undefined && bulk.curriculumEdition !== CURRICULUM_EDITION))
  ) {
    finding(
      'INCOMPATIBLE_DASHBOARD',
      dashboard.id,
      'blocked',
      'Dashboard reference date or curriculum edition does not match the demo.',
    );
    return plan;
  }
  const today = studyDay(now);
  const [classes, lessons, outcomes, orders, holidaySessions, historyUnits] = await Promise.all([
    db.class.findMany({
      where: { ...owned, deletedAt: null },
      include: {
        room: true,
        _count: { select: { sessions: true } },
        placements: {
          where: { enrollment: { status: 'ACTIVE', endDate: { gt: today } } },
          include: { enrollment: { select: { startDate: true, endDate: true } } },
        },
        enrollments: {
          where: { status: 'ACTIVE', endDate: { gt: today }, placements: { none: {} } },
          select: { startDate: true, endDate: true },
        },
      },
    }),
    db.lesson.findMany({
      where: { ...owned, kind: 'LESSON', status: 'APPROVED' },
      include: { outcomeLinks: true },
    }),
    db.learningOutcome.findMany({
      where: { id: { startsWith: DEMO_PREFIX } },
      select: { id: true },
    }),
    db.registrationOrder.findMany({ where: owned, include: { payment: true, enrollment: true } }),
    db.classSession.findMany({
      where: {
        ...owned,
        status: { not: 'CANCELLED' },
        AND: [
          {
            OR: TET_BREAKS.map((range) => ({
              startsAt: {
                gte: localInstant(referenceDate(range.fromDate)),
                lt: localInstant(addDays(referenceDate(range.toDate), 1)),
              },
            })),
          },
        ],
      },
      include: {
        room: true,
        participants: {
          include: {
            enrollment: true,
            replacementBookings: { include: { original: { include: { session: true } } } },
          },
        },
        _count: { select: { assessments: true, mutations: true } },
      },
    }),
    db.curriculumUnit.findMany({
      where: { id: { startsWith: `${BULK_PREFIX}unit_` }, status: 'APPROVED' },
    }),
  ]);

  const spareRoom = await db.room.findUnique({ where: { id: demoId('room_4') } });
  for (const classroom of classes) {
    const room =
      classroom.room ??
      (classroom.id === demoId('class_math-8-unassigned') &&
      !classroom.teacherId &&
      !classroom.isOpen &&
      classroom._count.sessions === 0 &&
      spareRoom?.isActive
        ? spareRoom
        : null);
    if (!room) {
      finding(
        'ROOM_REQUIRED',
        classroom.id,
        'blocked',
        'Assign a suitable room through the application before upgrading this dataset.',
      );
      continue;
    }
    if (classroom.isActive && !room.isActive) {
      finding(
        'ROOM_INACTIVE',
        classroom.id,
        'blocked',
        'Assign an active room through the application before upgrading this dataset.',
      );
      continue;
    }
    if (classroom.capacity === room.capacity && classroom.roomId === room.id) continue;
    const segments = [
      ...classroom.enrollments.map((e) => ({ classId: classroom.id, ...e })),
      ...classroom.placements.map((p) => ({
        classId: classroom.id,
        startDate:
          p.enrollment.startDate && p.effectiveFrom > p.enrollment.startDate
            ? p.effectiveFrom
            : p.enrollment.startDate,
        endDate:
          p.effectiveTo && p.enrollment.endDate && p.effectiveTo < p.enrollment.endDate
            ? p.effectiveTo
            : (p.effectiveTo ?? p.enrollment.endDate),
      })),
    ].filter((e) => e.startDate && e.endDate && e.startDate < e.endDate);
    const until = segments.reduce(
      (last, e) => (e.endDate && e.endDate > last ? e.endDate : last),
      today,
    );
    if (peakOccupancy(segments, today, until) > room.capacity) {
      finding(
        'ROOM_BELOW_RESERVED_SEATS',
        classroom.id,
        'blocked',
        'The room cannot hold the peak of future active enrollment placements.',
      );
      continue;
    }
    plan.actions.push({
      kind: 'CLASS',
      id: classroom.id,
      before: json({
        capacity: classroom.capacity,
        roomId: classroom.roomId,
        name: classroom.name,
        updatedAt: classroom.updatedAt,
      }),
      after: {
        capacity: room.capacity,
        roomId: room.id,
        name:
          classroom.id === demoId('class_math-8-full') &&
          classroom.name === 'Toán 8C - Đủ sĩ số' &&
          room.capacity !== 2
            ? 'Toán 8C - Nhóm demo'
            : classroom.name,
      },
    });
  }

  const outcomeIds = new Set(outcomes.map((outcome) => outcome.id));
  for (const lesson of lessons) {
    if (lesson.id === demoId('lesson_feedback_revision')) continue;
    if (lesson.outcomeLinks.length) continue;
    const key = Object.keys(TOPICS).find((key) => lesson.programId === demoId(`program_${key}`));
    const topic = key
      ? TOPICS[key].find(
          (topic) => lesson.title === topic.title || lesson.title.startsWith(`${topic.title} - `),
        )
      : undefined;
    if (!key || !topic) {
      finding(
        'UNMATCHED_LESSON',
        lesson.id,
        'blocked',
        'An approved lesson has no unambiguous textbook CLO; preserve it for a curriculum designer to review.',
      );
      continue;
    }
    const phase =
      lesson.title === topic.title ? 'Bài học' : lesson.title.slice(topic.title.length + 3);
    const outcomeId = demoId(`outcome_${key}_${TOPICS[key].indexOf(topic) + 1}`);
    if (!outcomeIds.has(outcomeId) || lesson.content !== lessonContent(topic, phase)) {
      finding(
        'EDITED_LESSON_PRESERVED',
        lesson.id,
        'blocked',
        'Content or CLO differs from the original seed; assign the CLO through the application.',
      );
      continue;
    }
    plan.actions.push({
      kind: 'LESSON_CLOS',
      id: lesson.id,
      before: { outcomeIds: [] },
      after: { outcomeIds: [outcomeId] },
    });
  }
  const revision = lessons.find((lesson) => lesson.id === demoId('lesson_feedback_revision'));
  if (revision?.basedOnId) {
    const original = lessons.find((lesson) => lesson.id === revision.basedOnId);
    const sourceIds = original?.outcomeLinks.map((link) => link.outcomeId) ?? [];
    const existingIds = revision.outcomeLinks.map((link) => link.outcomeId);
    const expectedIds = [
      ...new Set([
        ...existingIds.filter((id) => id !== demoId('outcome_math-8_1') || sourceIds.includes(id)),
        ...sourceIds,
      ]),
    ].sort();
    if (JSON.stringify([...existingIds].sort()) !== JSON.stringify(expectedIds)) {
      const unchanged =
        original &&
        revision.title === `${original.title} - Bổ sung ví dụ` &&
        revision.content ===
          `${original.content}\n\n## Bổ sung sau góp ý\nCho học sinh kiểm tra từng bước và giải thích lỗi thường gặp trước khi làm bài tổng hợp.`;
      if (!unchanged || !sourceIds.length)
        finding(
          'EDITED_FEEDBACK_PRESERVED',
          revision.id,
          'blocked',
          'The feedback revision was edited or its source CLO is missing; review its links through the application.',
        );
      else
        plan.actions.push({
          kind: 'LESSON_CLOS',
          id: revision.id,
          before: { outcomeIds: [...existingIds].sort() },
          after: { outcomeIds: expectedIds },
        });
    }
  }

  let legacyBills = 0;
  for (const order of orders) {
    if (order.listAmount !== null) continue;
    if (order.status !== 'DRAFT' || order.payment || order.enrollment || order.confirmedAt) {
      legacyBills++;
      finding(
        'LEGACY_BILL_PRESERVED',
        order.id,
        'preserve',
        'Retain the original bill, payment, refund basis and monetary history.',
      );
      continue;
    }
    const snapshot = manifestData(order.billSnapshot);
    const fee = snapshot.monthlyFee;
    if (!order.startDate || (typeof fee !== 'string' && typeof fee !== 'number')) {
      finding(
        'MISSING_PRICE_SNAPSHOT',
        order.id,
        'blocked',
        'Review this draft bill through the application; its original fee or term is missing.',
      );
      continue;
    }
    const monthlyFee = new Prisma.Decimal(fee);
    if (!order.quotedAmount.equals(monthlyFee.mul(order.packageMonths))) {
      legacyBills++;
      finding(
        'EDITED_BILL_PRESERVED',
        order.id,
        'preserve',
        'The draft amount differs from the old seed formula; keep the existing amount for review.',
      );
      continue;
    }
    plan.actions.push({
      kind: 'DRAFT_PRICE',
      id: order.id,
      before: json({ quotedAmount: order.quotedAmount.toString(), updatedAt: order.updatedAt }),
      after: json(priceTuition(monthlyFee, order.startDate, order.packageMonths)),
    });
  }

  let legacySessions = 0;
  for (const session of holidaySessions.filter((s) => isSeedHoliday(studyDay(s.startsAt)))) {
    if (session.status === 'COMPLETED' || session.startsAt <= now) {
      legacySessions++;
      finding(
        'HISTORICAL_SESSION_PRESERVED',
        session.id,
        'preserve',
        'Retain the original session time, attendance, grades and historical reports.',
      );
      continue;
    }
    const participant = session.participants[0];
    const booking = participant?.replacementBookings[0];
    if (
      !session.id.startsWith(demoId('makeup_session_')) ||
      session.generationId ||
      session.revision !== 1 ||
      session.summary !== null ||
      session.participants.length !== 1 ||
      participant.kind !== 'MAKEUP' ||
      !booking ||
      !['BOOKED', 'CANCELLED'].includes(booking.status) ||
      !session.room?.isActive ||
      session._count.assessments ||
      session._count.mutations ||
      !participant.enrollment.studentProfileId ||
      !participant.enrollment.startDate ||
      !participant.enrollment.endDate
    ) {
      finding(
        'EDITED_SESSION_PRESERVED',
        session.id,
        'blocked',
        'Reschedule this upcoming holiday session through the application; it has application activity or is not an untouched makeup fixture.',
      );
      continue;
    }
    const target = await findMakeupTarget(db, {
      sourceStartsAt: booking.original.session.startsAt,
      startDate: participant.enrollment.startDate,
      endDate: participant.enrollment.endDate,
      today,
      past: false,
      classId: session.classId,
      roomId: session.room.id,
      teacherId: session.teacherId,
      studentProfileId: participant.enrollment.studentProfileId,
      excludeSessionId: session.id,
    });
    if (!target)
      finding(
        'NO_MAKEUP_WINDOW',
        session.id,
        'blocked',
        'No eligible day remains within the enrollment term and 21-day window.',
      );
    else
      plan.actions.push({
        kind: 'MAKEUP_SESSION',
        id: session.id,
        before: json({
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          revision: session.revision,
        }),
        after: json(target),
      });
  }

  for (const unit of historyUnits) {
    const successor = await db.curriculumUnit.findFirst({
      where: {
        programId: unit.programId,
        fromDate: { gt: unit.toDate },
        OR: [{ status: 'APPROVED' }, { status: 'ARCHIVED', archiveReason: 'SUPERSEDED' }],
      },
      orderBy: [{ fromDate: 'asc' }, { id: 'asc' }],
    });
    if (!successor) {
      finding(
        'HISTORY_SUCCESSOR_MISSING',
        unit.id,
        'blocked',
        'No published successor is available for this historical curriculum.',
      );
      continue;
    }
    plan.actions.push({
      kind: 'HISTORY_UNIT',
      id: unit.id,
      before: { status: unit.status, revision: unit.revision },
      after: json({
        status: 'ARCHIVED',
        archiveReason: 'SUPERSEDED',
        supersededById: successor.id,
        archivedAt: successor.approvedAt ?? now,
      }),
    });
  }
  if (stored.version !== DEMO_SEED_VERSION)
    plan.actions.push({
      kind: 'MANIFEST',
      id: demo.id,
      before: json(stored),
      after: json({
        ...stored,
        version: DEMO_SEED_VERSION,
        repairedAt: now,
        legacyBillsPreserved: legacyBills,
        legacySessionsPreserved: legacySessions,
      }),
    });
  if (
    dashboard &&
    (bulk.version !== DASHBOARD_SEED_VERSION ||
      bulk.demoSeedVersion !== DEMO_SEED_VERSION ||
      bulk.curriculumEdition !== CURRICULUM_EDITION)
  )
    plan.actions.push({
      kind: 'MANIFEST',
      id: dashboard.id,
      before: json(bulk),
      after: json({
        ...bulk,
        version: DASHBOARD_SEED_VERSION,
        demoSeedVersion: DEMO_SEED_VERSION,
        curriculumEdition: CURRICULUM_EDITION,
        repairedAt: now,
      }),
    });
  return plan;
}

/** Recompute under locks, then atomically apply only the reviewed categories of seed repairs. */
export async function applySeedRepairs(
  prisma: PrismaClient,
  now = new Date(),
): Promise<SeedRepairPlan> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM audit_logs WHERE id IN (${demoId('manifest')}, ${DASHBOARD_MANIFEST_ID}) FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM programs WHERE LEFT(id, ${DEMO_PREFIX.length}) = ${DEMO_PREFIX} FOR UPDATE`;
      await tx.$queryRaw`SELECT r.id FROM rooms r INNER JOIN classes c ON c.roomId = r.id WHERE LEFT(c.id, ${DEMO_PREFIX.length}) = ${DEMO_PREFIX} OR LEFT(c.id, ${BULK_PREFIX.length}) = ${BULK_PREFIX} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM classes WHERE LEFT(id, ${DEMO_PREFIX.length}) = ${DEMO_PREFIX} OR LEFT(id, ${BULK_PREFIX.length}) = ${BULK_PREFIX} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM lessons WHERE LEFT(id, ${DEMO_PREFIX.length}) = ${DEMO_PREFIX} OR LEFT(id, ${BULK_PREFIX.length}) = ${BULK_PREFIX} FOR UPDATE`;
      await tx.$queryRaw`SELECT lessonId FROM lesson_outcomes WHERE LEFT(lessonId, ${DEMO_PREFIX.length}) = ${DEMO_PREFIX} OR LEFT(lessonId, ${BULK_PREFIX.length}) = ${BULK_PREFIX} FOR UPDATE`;
      const plan = await planSeedRepairs(tx, now);
      if (!plan.compatible)
        throw new Error(
          'Repair is blocked. Review the preview findings; no changes were committed.',
        );
      const manifest = await tx.auditLog.findUniqueOrThrow({ where: { id: demoId('manifest') } });
      for (const change of plan.actions) {
        let changed = 1;
        switch (change.kind) {
          case 'CLASS': {
            const result = await tx.class.updateMany({
              where: {
                id: change.id,
                capacity: repairInteger(change.before, 'capacity'),
                roomId: change.before.roomId as string | null,
                updatedAt: new Date(repairString(change.before, 'updatedAt')),
              },
              data: {
                capacity: repairInteger(change.after, 'capacity'),
                roomId: repairString(change.after, 'roomId'),
                name: repairString(change.after, 'name'),
              },
            });
            changed = result.count;
            break;
          }
          case 'LESSON_CLOS': {
            const before = repairIds(change.before);
            const after = repairIds(change.after);
            const remove = before.filter((id) => !after.includes(id));
            if (remove.length)
              await tx.lessonOutcome.deleteMany({
                where: { lessonId: change.id, outcomeId: { in: remove } },
              });
            const added = after.filter((id) => !before.includes(id));
            if (added.length)
              await tx.lessonOutcome.createMany({
                data: added.map((outcomeId) => ({ lessonId: change.id, outcomeId })),
                skipDuplicates: true,
              });
            break;
          }
          case 'DRAFT_PRICE': {
            const result = await tx.registrationOrder.updateMany({
              where: {
                id: change.id,
                status: 'DRAFT',
                listAmount: null,
                confirmedAt: null,
                updatedAt: new Date(repairString(change.before, 'updatedAt')),
                payment: null,
                enrollment: null,
              },
              data: {
                quotedAmount: repairString(change.after, 'quotedAmount'),
                listAmount: repairString(change.after, 'listAmount'),
                tetDiscountAmount:
                  change.after.tetDiscountAmount === null
                    ? null
                    : repairString(change.after, 'tetDiscountAmount'),
                tetPeriodStart:
                  change.after.tetPeriodStart === null
                    ? null
                    : new Date(repairString(change.after, 'tetPeriodStart')),
                tetPeriodEnd:
                  change.after.tetPeriodEnd === null
                    ? null
                    : new Date(repairString(change.after, 'tetPeriodEnd')),
              },
            });
            changed = result.count;
            break;
          }
          case 'MAKEUP_SESSION': {
            const result = await tx.classSession.updateMany({
              where: {
                id: change.id,
                status: 'SCHEDULED',
                revision: repairInteger(change.before, 'revision'),
                startsAt: new Date(repairString(change.before, 'startsAt')),
              },
              data: {
                startsAt: new Date(repairString(change.after, 'startsAt')),
                endsAt: new Date(repairString(change.after, 'endsAt')),
                revision: { increment: 1 },
              },
            });
            changed = result.count;
            break;
          }
          case 'HISTORY_UNIT': {
            const result = await tx.curriculumUnit.updateMany({
              where: {
                id: change.id,
                status: 'APPROVED',
                revision: repairInteger(change.before, 'revision'),
              },
              data: {
                status: 'ARCHIVED',
                archiveReason: 'SUPERSEDED',
                supersededById: repairString(change.after, 'supersededById'),
                archivedAt: new Date(repairString(change.after, 'archivedAt')),
                revision: { increment: 1 },
              },
            });
            changed = result.count;
            break;
          }
          case 'MANIFEST':
            await tx.auditLog.update({
              where: { id: change.id },
              data: { afterData: change.after },
            });
            break;
        }
        if (changed !== 1)
          throw new Error(`Record changed during repair: ${change.id}. No changes were committed.`);
        await tx.auditLog.create({
          data: {
            actorUserId: manifest.actorUserId,
            action: 'SEED_WORKFLOW_REPAIRED',
            entityType: change.kind,
            entityId: change.id,
            beforeData: change.before,
            afterData: change.after,
            createdAt: now,
          },
        });
      }
      return plan;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 30_000,
      timeout: 900_000,
    },
  );
}
