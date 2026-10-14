import type { ClassSession, Prisma } from '@prisma/client';
import {
  lastMonthlySlots,
  slotsForRange,
} from '../../modules/curriculum-scheduling/curriculum-scheduling.service';
import { assignedTeacherAt } from '../../modules/registration-flow/class-teacher';
import type { SeedUsers } from './seed-accounts';
import type { SeedCatalog } from './seed-catalog';
import type { DemoEnrollment } from './seed-enrollments';
import { addDays, dateOnly, demoId, localInstant, studyDay } from './seed-calendar';

export async function seedSessions(
  tx: Prisma.TransactionClient,
  users: SeedUsers,
  catalog: SeedCatalog,
  enrollments: DemoEnrollment[],
  today: Date,
): Promise<Record<string, ClassSession[]>> {
  const result: Record<string, ClassSession[]> = {};
  for (const [key, classroom] of Object.entries(catalog.classes)) {
    if (!classroom.teacherId || !classroom.isActive) continue;
    const programKey = Object.keys(catalog.units).find(
      (candidate) => catalog.units[candidate].programId === classroom.programId,
    );
    if (!programKey) throw new Error(`Missing curriculum for ${classroom.name}`);
    const unit = catalog.units[programKey];
    const generation = await tx.scheduleGeneration.upsert({
      where: { id: demoId(`generation_${key}`) },
      update: {},
      create: {
        id: demoId(`generation_${key}`),
        classId: classroom.id,
        unitId: unit.id,
        actorUserId: users.manager.id,
        key: `demo-${key}`,
        requestHash: '0'.repeat(64),
        fromDate: catalog.from,
        toDate: catalog.to,
        createdAt: localInstant(addDays(catalog.from, -1), 9),
      },
    });
    const slots = slotsForRange(
      classroom.weeklySchedules,
      dateOnly(catalog.from),
      dateOnly(catalog.to),
    );
    const last = lastMonthlySlots(slots);
    const regular = catalog.lessons[programKey].filter((lesson) => lesson.kind === 'LESSON');
    let regularIndex = 0;
    result[key] = [];
    for (const [index, slot] of slots.entries()) {
      const lesson =
        last.get(slot.date.slice(0, 7)) === index
          ? catalog.lessons[programKey].find(
              (row) => row.kind === 'MONTHLY_TEST' && row.monthKey === slot.date.slice(0, 7),
            )
          : regular[regularIndex++];
      if (!lesson) throw new Error(`Not enough approved content for ${classroom.name}`);
      const past = slot.startsAt < localInstant(today);
      const cancelled = key === 'physics-8-closed' && index === slots.length - 2;
      const teacherId =
        key === 'math-8-a' && index === 4
          ? users['substitute-teacher'].id
          : assignedTeacherAt(classroom, slot.startsAt);
      if (!teacherId) throw new Error(`Missing active teacher for ${classroom.name}`);
      const session = await tx.classSession.upsert({
        where: { id: demoId(`session_${key}_${index + 1}`) },
        update: {},
        create: {
          id: demoId(`session_${key}_${index + 1}`),
          classId: classroom.id,
          lessonId: lesson.id,
          teacherId,
          roomId: classroom.roomId,
          generationId: generation.id,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          status: cancelled ? 'CANCELLED' : past ? 'COMPLETED' : 'SCHEDULED',
          summary: past
            ? `Đã hoàn thành: ${lesson.title}. Học sinh luyện tập và trao đổi các lỗi thường gặp.`
            : null,
          cancelReason: cancelled ? 'Phòng học bảo trì; trung tâm đã thông báo phụ huynh.' : null,
          cancelledAt: cancelled ? localInstant(today, 8) : null,
        },
      });
      result[key].push(session);
      const day = studyDay(session.startsAt);
      for (const [studentIndex, item] of enrollments.entries()) {
        const enrollment = item.enrollment;
        if (
          !enrollment.startDate ||
          !enrollment.endDate ||
          day < enrollment.startDate ||
          day >= enrollment.endDate ||
          (enrollment.endedAt && session.startsAt >= enrollment.endedAt)
        )
          continue;
        const placement = item.placements.find(
          (row) =>
            row.effectiveFrom <= session.startsAt &&
            (!row.effectiveTo || row.effectiveTo > session.startsAt),
        );
        if (placement?.classId !== classroom.id || cancelled) continue;
        await tx.sessionParticipant.upsert({
          where: { sessionId_enrollmentId: { sessionId: session.id, enrollmentId: enrollment.id } },
          update: {},
          create: {
            id: demoId(`participant_${key}_${index + 1}_${item.key}`),
            sessionId: session.id,
            enrollmentId: enrollment.id,
            attendance: past
              ? (index + studentIndex) % 5 === 0
                ? 'ABSENT'
                : 'PRESENT'
              : 'UNMARKED',
          },
        });
      }
    }
  }
  return result;
}

export async function seedLeavesAndMakeups(
  tx: Prisma.TransactionClient,
  users: SeedUsers,
  enrollments: DemoEnrollment[],
  sessions: Record<string, ClassSession[]>,
  today: Date,
): Promise<void> {
  const binh = enrollments.find((item) => item.key === 'binh-expiring')!.enrollment;
  const future = sessions['math-8-a'].filter(
    (row) => row.status === 'SCHEDULED' && row.startsAt > localInstant(today, 23),
  );
  for (const [index, status] of ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].entries()) {
    const session = future[index];
    if (!session) continue;
    const day = studyDay(session.startsAt);
    const enrollment = enrollments.find((item) => item.key === 'an-math')!.enrollment;
    await tx.leaveRequest.upsert({
      where: { id: demoId(`leave_single_${status}`) },
      update: {},
      create: {
        id: demoId(`leave_single_${status}`),
        enrollmentId: enrollment.id,
        sessionId: session.id,
        kind: 'SINGLE_ABSENCE',
        fromDate: day,
        toDate: day,
        reason:
          status === 'PENDING'
            ? 'Gia đình có việc riêng, xin nghỉ một buổi.'
            : 'Học sinh cần nghỉ để tham gia hoạt động của trường.',
        requestedById: users.parent.id,
        status: status as 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED',
        decidedById: status === 'PENDING' ? null : users.staff.id,
        decisionNote: status === 'REJECTED' ? 'Đề nghị phụ huynh điều chỉnh ngày nghỉ.' : null,
        createdAt: localInstant(addDays(today, -1), 9),
      },
    });
  }
  const pauseFrom = addDays(today, 1);
  const pauseTo = addDays(today, 3);
  if (binh.endDate && pauseTo < binh.endDate) {
    await tx.leaveRequest.upsert({
      where: { id: demoId('leave_period') },
      update: {},
      create: {
        id: demoId('leave_period'),
        enrollmentId: binh.id,
        kind: 'PERIOD_PAUSE',
        fromDate: pauseFrom,
        toDate: pauseTo,
        reason: 'Gia đình đi xa trong ba ngày.',
        requestedById: users['parent-2'].id,
        decidedById: users.staff.id,
        status: 'APPROVED',
        decisionNote: 'Đã ghi nhận tạm nghỉ; giữ nguyên thời hạn gói học.',
        createdAt: localInstant(addDays(today, -1), 9),
      },
    });
    // Only initialize seed-owned attendance; a repeated run must retain teacher edits.
    for (const session of future.filter(
      (row) => studyDay(row.startsAt) >= pauseFrom && studyDay(row.startsAt) <= pauseTo,
    )) {
      const id = demoId(`excused_${session.id}_${binh.id}`);
      const participant = await tx.sessionParticipant.findUnique({
        where: { sessionId_enrollmentId: { sessionId: session.id, enrollmentId: binh.id } },
      });
      if (participant && participant.attendance === 'UNMARKED') {
        const applied = await tx.auditLog.findUnique({ where: { id } });
        if (!applied) {
          await tx.sessionParticipant.update({
            where: { id: participant.id },
            data: { attendance: 'EXCUSED' },
          });
          await tx.auditLog.create({
            data: {
              id,
              actorUserId: users.staff.id,
              action: 'LEAVE_APPROVED',
              entityType: 'LeaveRequest',
              entityId: demoId('leave_period'),
              createdAt: localInstant(today, 9),
            },
          });
        }
      }
    }
  }

  const nga = enrollments.find((item) => item.key === 'nga-math')!.enrollment;
  const originals = sessions['math-8-a'];
  const pastSources = originals.filter(
    (source) =>
      source.status === 'COMPLETED' &&
      source.startsAt < localInstant(addDays(today, -2)) &&
      nga.startDate &&
      studyDay(source.startsAt) >= nga.startDate,
  );
  const futureSources = originals.filter(
    (source) =>
      source.status === 'SCHEDULED' &&
      source.startsAt > localInstant(today, 23) &&
      nga.endDate &&
      addDays(studyDay(source.startsAt), 1) < nga.endDate,
  );
  const bookings = [
    { status: 'COMPLETED' as const, source: pastSources.at(-3) },
    { status: 'MISSED' as const, source: pastSources.at(-2) },
    { status: 'BOOKED' as const, source: futureSources[0] },
    { status: 'CANCELLED' as const, source: futureSources[1] },
  ];
  for (const { status, source } of bookings) {
    if (!source) throw new Error(`Insufficient sessions for ${status} makeup fixture`);
    const bookingId = demoId(`makeup_${status}`);
    if (await tx.makeupBooking.findUnique({ where: { id: bookingId } })) continue;
    const targetClass = await tx.class.findUniqueOrThrow({
      where: { id: sessions['math-8-b'][0].classId },
    });
    const targetDay = addDays(studyDay(source.startsAt), 1);
    // Manual additional sessions avoid assuming parallel classes teach a lesson on the same date.
    const target = await tx.classSession.upsert({
      where: { id: demoId(`makeup_session_${status}`) },
      update: {},
      create: {
        id: demoId(`makeup_session_${status}`),
        classId: targetClass.id,
        lessonId: source.lessonId,
        teacherId: users['substitute-teacher'].id,
        roomId: targetClass.roomId,
        startsAt: localInstant(targetDay, 14),
        endsAt: localInstant(targetDay, 16),
        status: status === 'COMPLETED' || status === 'MISSED' ? 'COMPLETED' : 'SCHEDULED',
        summary:
          status === 'COMPLETED' || status === 'MISSED'
            ? 'Buổi bổ sung để học sinh hoàn thành nội dung học bù.'
            : null,
      },
    });
    const original = await tx.sessionParticipant.findUniqueOrThrow({
      where: { sessionId_enrollmentId: { sessionId: source.id, enrollmentId: nga.id } },
    });
    if (source.status === 'COMPLETED')
      await tx.sessionParticipant.update({
        where: { id: original.id },
        data: { attendance: 'ABSENT' },
      });
    else {
      const day = studyDay(source.startsAt);
      await tx.leaveRequest.upsert({
        where: { id: demoId(`leave_makeup_${status}`) },
        update: {},
        create: {
          id: demoId(`leave_makeup_${status}`),
          enrollmentId: nga.id,
          sessionId: source.id,
          kind: 'SINGLE_ABSENCE',
          fromDate: day,
          toDate: day,
          reason: 'Xin nghỉ buổi học chính và đăng ký học bù cùng nội dung.',
          status: 'APPROVED',
          requestedById: users['parent-4'].id,
          decidedById: users.staff.id,
          createdAt: localInstant(today, 9),
        },
      });
    }
    const replacement = await tx.sessionParticipant.upsert({
      where: { sessionId_enrollmentId: { sessionId: target.id, enrollmentId: nga.id } },
      update: {},
      create: {
        id: demoId(`makeup_participant_${status}`),
        sessionId: target.id,
        enrollmentId: nga.id,
        kind: 'MAKEUP',
        attendance:
          status === 'COMPLETED' ? 'PRESENT' : status === 'MISSED' ? 'ABSENT' : 'UNMARKED',
        cancelled: status === 'CANCELLED',
      },
    });
    await tx.makeupBooking.create({
      data: {
        id: bookingId,
        originalParticipantId: original.id,
        activeOriginalId: status === 'BOOKED' || status === 'COMPLETED' ? original.id : null,
        replacementParticipantId: replacement.id,
        managerId: users.staff.id,
        status,
        createdAt:
          source.status === 'COMPLETED' ? addDays(source.startsAt, -1) : localInstant(today, 9),
      },
    });
  }
}
