import { Prisma, type Enrollment, type EnrollmentPlacement } from '@prisma/client';
import { slotsForRange } from '../../modules/curriculum-scheduling/curriculum-scheduling.service';
import type { SeedUsers } from './seed-accounts';
import type { DemoClass, SeedCatalog } from './seed-catalog';
import { addDays, addMonths, dateOnly, demoId, localInstant } from './seed-calendar';

export interface DemoEnrollment {
  key: string;
  enrollment: Enrollment;
  placements: EnrollmentPlacement[];
}

export function nextStudyDay(classroom: DemoClass, from: Date): Date {
  const slot = slotsForRange(
    classroom.weeklySchedules,
    dateOnly(from),
    dateOnly(addDays(from, 7)),
  )[0];
  if (!slot) throw new Error(`No weekly schedule for ${classroom.name}`);
  return new Date(`${slot.date}T00:00:00Z`);
}

export async function seedEnrollments(
  tx: Prisma.TransactionClient,
  users: SeedUsers,
  catalog: SeedCatalog,
  today: Date,
): Promise<DemoEnrollment[]> {
  const historicalStart = addDays(catalog.from, 7);
  const definitions = [
    { key: 'an-math', student: 'an', classKey: 'math-8-a', months: 3, from: historicalStart },
    { key: 'an-physics', student: 'an', classKey: 'physics-8-a', months: 3, from: historicalStart },
    {
      key: 'binh-expiring',
      student: 'binh',
      classKey: 'math-8-a',
      months: 1,
      from: addDays(today, -25),
    },
    {
      key: 'chi-transfer',
      student: 'chi',
      classKey: 'math-8-a',
      months: 3,
      from: historicalStart,
      transfer: true,
    },
    {
      key: 'dung-ended',
      student: 'dung',
      classKey: 'math-8-a',
      months: 3,
      from: historicalStart,
      ended: true,
    },
    { key: 'ha-full', student: 'ha', classKey: 'math-8-full', months: 3, from: historicalStart },
    {
      key: 'ngoc-full',
      student: 'ngoc',
      classKey: 'math-8-full',
      months: 3,
      from: historicalStart,
    },
    {
      key: 'khanh-upcoming',
      student: 'khanh',
      classKey: 'math-9-a',
      months: 3,
      from: addDays(today, 7),
    },
    { key: 'linh-math', student: 'linh', classKey: 'math-6-a', months: 3, from: historicalStart },
    { key: 'minh-math', student: 'minh', classKey: 'math-7-a', months: 3, from: historicalStart },
    {
      key: 'phuc-withdrawn',
      student: 'phuc',
      classKey: 'math-8-a',
      months: 1,
      from: historicalStart,
      ended: true,
    },
    { key: 'nga-math', student: 'nga', classKey: 'math-8-a', months: 3, from: historicalStart },
  ];
  const result: DemoEnrollment[] = [];
  for (const item of definitions) {
    const classroom = catalog.classes[item.classKey];
    const student = catalog.students[item.student];
    const parent = await tx.parentProfile.findUniqueOrThrow({
      where: { id: student.parentProfileId },
      include: { user: true },
    });
    const startDate = nextStudyDay(classroom, item.from);
    const endDate = addMonths(startDate, item.months);
    const transferAt = localInstant(addDays(today, -7));
    const confirmedAt = localInstant(
      item.from > today ? addDays(today, -1) : addDays(startDate, -3),
      10,
    );
    const endedAt = item.ended
      ? localInstant(endDate < today ? endDate : addDays(today, -10))
      : null;
    const order = await tx.registrationOrder.upsert({
      where: { id: demoId(`order_${item.key}`) },
      update: {},
      create: {
        id: demoId(`order_${item.key}`),
        type: 'EXISTING_STUDENT_NEW_SUBJECT',
        parentEmail: parent.user.email,
        parentPhone: parent.phone,
        studentFullName: student.fullName,
        studentGrade: student.grade,
        targetStudentId: student.id,
        classId: classroom.id,
        packageMonths: item.months,
        quotedAmount: classroom.monthlyFee.mul(item.months),
        billSnapshot: billSnapshot(classroom, student, parent),
        startDate,
        endDate,
        createdByManagerId: users.staff.id,
        status: 'COMPLETED',
        confirmedAt,
        linkedAt: confirmedAt,
        createdAt: addDays(confirmedAt, -1),
      },
    });
    await tx.payment.upsert({
      where: { registrationOrderId: order.id },
      update: {},
      create: {
        id: demoId(`payment_${item.key}`),
        registrationOrderId: order.id,
        amount: order.quotedAmount,
        currency: 'VND',
        receiptNumber: `DEMO-${item.key.toUpperCase()}`,
        confirmedByManagerId: users.staff.id,
        confirmedAt,
        createdAt: confirmedAt,
      },
    });
    const enrollment = await tx.enrollment.upsert({
      where: { registrationOrderId: order.id },
      update: {},
      create: {
        id: demoId(`enrollment_${item.key}`),
        registrationOrderId: order.id,
        studentProfileId: student.id,
        classId: item.transfer ? catalog.classes['math-8-b'].id : classroom.id,
        packageMonths: item.months,
        status: item.ended ? 'ENDED' : 'ACTIVE',
        startDate,
        endDate,
        activatedAt: confirmedAt,
        endedAt,
        createdAt: confirmedAt,
      },
    });
    const first = await tx.enrollmentPlacement.upsert({
      where: { id: demoId(`placement_${item.key}_1`) },
      update: {},
      create: {
        id: demoId(`placement_${item.key}_1`),
        enrollmentId: enrollment.id,
        classId: classroom.id,
        effectiveFrom: localInstant(startDate),
        effectiveTo: item.transfer ? transferAt : endedAt,
      },
    });
    const placements = [first];
    if (item.transfer) {
      const target = catalog.classes['math-8-b'];
      placements.push(
        await tx.enrollmentPlacement.upsert({
          where: { id: demoId(`placement_${item.key}_2`) },
          update: {},
          create: {
            id: demoId(`placement_${item.key}_2`),
            enrollmentId: enrollment.id,
            classId: target.id,
            effectiveFrom: transferAt,
          },
        }),
      );
      await tx.enrollmentTransfer.upsert({
        where: { id: demoId(`transfer_${item.key}`) },
        update: {},
        create: {
          id: demoId(`transfer_${item.key}`),
          enrollmentId: enrollment.id,
          fromClassId: classroom.id,
          toClassId: target.id,
          effectiveAt: transferAt,
          managerId: users.staff.id,
          reason: 'Phụ huynh đề nghị chuyển sang lịch thứ Ba và thứ Năm.',
          createdAt: addDays(transferAt, -1),
        },
      });
    }
    await tx.auditLog.upsert({
      where: { id: demoId(`audit_payment_${item.key}`) },
      update: {},
      create: {
        id: demoId(`audit_payment_${item.key}`),
        actorUserId: users.staff.id,
        action: 'REGISTRATION_CONFIRM_PAYMENT',
        entityType: 'RegistrationOrder',
        entityId: order.id,
        afterData: { paymentId: demoId(`payment_${item.key}`), enrollmentId: enrollment.id },
        createdAt: confirmedAt,
      },
    });
    result.push({ key: item.key, enrollment, placements });
  }

  for (const [key, studentKey, classKey, status] of [
    ['thai-draft', 'thai', 'math-8-a', 'DRAFT'],
    ['ha-cancelled', 'ha', 'physics-8-a', 'CANCELLED'],
  ] as const) {
    const classroom = catalog.classes[classKey];
    const student = catalog.students[studentKey];
    const parent = await tx.parentProfile.findUniqueOrThrow({
      where: { id: student.parentProfileId },
      include: { user: true },
    });
    const startDate = nextStudyDay(classroom, addDays(today, 1));
    await tx.registrationOrder.upsert({
      where: { id: demoId(`order_${key}`) },
      update: {},
      create: {
        id: demoId(`order_${key}`),
        type: 'EXISTING_STUDENT_NEW_SUBJECT',
        parentEmail: parent.user.email,
        parentPhone: parent.phone,
        studentFullName: student.fullName,
        studentGrade: student.grade,
        targetStudentId: student.id,
        classId: classroom.id,
        packageMonths: 1,
        quotedAmount: classroom.monthlyFee,
        billSnapshot: billSnapshot(classroom, student, parent),
        startDate,
        endDate: addMonths(startDate, 1),
        createdByManagerId: users.staff.id,
        status,
        createdAt: localInstant(addDays(today, -1), 9),
      },
    });
  }
  return result;
}

function billSnapshot(
  classroom: DemoClass,
  student: { id: string; fullName: string; grade: number },
  parent: { phone: string | null; user: { displayName: string | null; email: string } },
): Prisma.InputJsonObject {
  return {
    parent: { displayName: parent.user.displayName, email: parent.user.email, phone: parent.phone },
    student: { id: student.id, fullName: student.fullName, grade: student.grade },
    class: {
      id: classroom.id,
      name: classroom.name,
      subject: classroom.program.subject,
      grade: classroom.program.grade,
      schedules: classroom.weeklySchedules.map((slot) => ({
        weekday: slot.weekday,
        startTime: slot.startTime,
        endTime: slot.endTime,
      })),
    },
    monthlyFee: classroom.monthlyFee.toString(),
  };
}
