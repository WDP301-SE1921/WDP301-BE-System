import { Prisma } from '@prisma/client';
import { priceTuition } from '../../modules/registration-flow/tuition-pricing';
import { dateOnly, studyDay } from './seed-calendar';
import { isSeedHoliday } from './seed-makeup';

/** Run before committing a newly created layer. Existing application edits are never replayed. */
export async function assertSeedIntegrity(
  db: Prisma.TransactionClient,
  prefix: string,
): Promise<void> {
  const owned = { id: { startsWith: prefix } };
  const [classes, lessons, orders, sessions, makeups] = await Promise.all([
    db.class.findMany({ where: owned, include: { room: true } }),
    db.lesson.findMany({
      where: { ...owned, kind: 'LESSON' },
      select: {
        id: true,
        programId: true,
        outcomeLinks: {
          select: { outcome: { select: { outcomeSet: { select: { programId: true } } } } },
        },
      },
    }),
    db.registrationOrder.findMany({ where: owned, include: { payment: true, enrollment: true } }),
    db.classSession.findMany({
      where: { status: { not: 'CANCELLED' }, OR: [owned, { participants: { some: owned } }] },
      include: {
        class: { select: { capacity: true } },
        participants: {
          where: { cancelled: false },
          include: {
            enrollment: {
              select: { startDate: true, endDate: true, endedAt: true, placements: true },
            },
          },
        },
      },
      orderBy: { startsAt: 'asc' },
    }),
    db.makeupBooking.findMany({
      where: owned,
      include: {
        original: { include: { session: true } },
        replacement: { include: { session: true } },
      },
    }),
  ]);
  const problems: string[] = [];
  const check = (valid: boolean, code: string, id: string): void => {
    if (!valid && problems.length < 20) problems.push(`${code}: ${id}`);
  };
  for (const classroom of classes) {
    check(!!classroom.room, 'ROOM_REQUIRED', classroom.id);
    check(classroom.room?.capacity === classroom.capacity, 'ROOM_CAPACITY_MISMATCH', classroom.id);
    if (classroom.isActive) check(!!classroom.room?.isActive, 'ROOM_INACTIVE', classroom.id);
  }
  for (const lesson of lessons) {
    check(lesson.outcomeLinks.length > 0, 'LESSON_OUTCOME_MISSING', lesson.id);
    check(
      lesson.outcomeLinks.every((link) => link.outcome.outcomeSet.programId === lesson.programId),
      'CLO_PROGRAM_MISMATCH',
      lesson.id,
    );
  }
  for (const order of orders) {
    const snapshot = order.billSnapshot;
    const fee =
      snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
        ? snapshot.monthlyFee
        : undefined;
    if (order.startDate && (typeof fee === 'string' || typeof fee === 'number')) {
      const expected = priceTuition(new Prisma.Decimal(fee), order.startDate, order.packageMonths);
      check(order.quotedAmount.equals(expected.quotedAmount), 'TUITION_PRICE_MISMATCH', order.id);
      check(!!order.listAmount?.equals(expected.listAmount), 'TUITION_SNAPSHOT_MISSING', order.id);
      check(
        (order.tetDiscountAmount?.toString() ?? null) ===
          (expected.tetDiscountAmount?.toString() ?? null),
        'TET_DISCOUNT_MISMATCH',
        order.id,
      );
      check(
        order.tetPeriodStart?.getTime() === expected.tetPeriodStart?.getTime() &&
          order.tetPeriodEnd?.getTime() === expected.tetPeriodEnd?.getTime(),
        'TET_PERIOD_MISMATCH',
        order.id,
      );
    } else check(false, 'TUITION_SNAPSHOT_MISSING', order.id);
    if (order.status === 'COMPLETED') {
      check(
        order.payment?.status === 'CONFIRMED' && order.payment.amount.equals(order.quotedAmount),
        'PAYMENT_ORDER_MISMATCH',
        order.id,
      );
      check(!!order.enrollment, 'COMPLETED_ORDER_WITHOUT_ENROLLMENT', order.id);
    }
  }
  const occupied = new Map<string, { id: string; endsAt: Date }>();
  for (const session of sessions) {
    const day = studyDay(session.startsAt);
    check(!isSeedHoliday(day), 'SESSION_IN_TET_BREAK', session.id);
    check(session.endsAt > session.startsAt, 'INVALID_SESSION_TIME', session.id);
    check(
      session.participants.filter((p) => p.attendance !== 'EXCUSED').length <=
        session.class.capacity,
      'SESSION_OVER_CAPACITY',
      session.id,
    );
    for (const key of [
      `class:${session.classId}`,
      `teacher:${session.teacherId}`,
      ...(session.roomId ? [`room:${session.roomId}`] : []),
    ]) {
      const previous = occupied.get(key);
      check(
        !previous || previous.endsAt <= session.startsAt,
        'SESSION_RESOURCE_OVERLAP',
        `${session.id}/${previous?.id ?? ''}`,
      );
      if (!previous || session.endsAt > previous.endsAt) occupied.set(key, session);
    }
    for (const participant of session.participants) {
      const enrollment = participant.enrollment;
      check(
        !!enrollment.startDate &&
          !!enrollment.endDate &&
          day >= enrollment.startDate &&
          day < enrollment.endDate &&
          (!enrollment.endedAt || session.startsAt < enrollment.endedAt),
        'PARTICIPANT_OUTSIDE_ENROLLMENT',
        participant.id,
      );
      if (participant.kind === 'REGULAR')
        check(
          enrollment.placements.some(
            (p) =>
              p.classId === session.classId &&
              p.effectiveFrom <= session.startsAt &&
              (!p.effectiveTo || session.startsAt < p.effectiveTo),
          ),
          'PARTICIPANT_PLACEMENT_MISMATCH',
          participant.id,
        );
    }
  }
  for (const booking of makeups) {
    const original = booking.original;
    const replacement = booking.replacement;
    check(
      original.enrollmentId === replacement.enrollmentId &&
        original.session.lessonId === replacement.session.lessonId,
      'MAKEUP_CONTENT_MISMATCH',
      booking.id,
    );
    check(
      replacement.session.startsAt > original.session.endsAt,
      'MAKEUP_BEFORE_SOURCE',
      booking.id,
    );
    if (booking.status === 'CANCELLED')
      check(
        replacement.cancelled && booking.activeOriginalId === null,
        'CANCELLED_MAKEUP_RESERVED',
        booking.id,
      );
    if (booking.status === 'COMPLETED' || booking.status === 'MISSED')
      check(replacement.session.status === 'COMPLETED', 'MAKEUP_STATUS_MISMATCH', booking.id);
  }
  if (problems.length)
    throw new Error(`Seed integrity failed (${dateOnly(new Date())}):\n${problems.join('\n')}`);
}
