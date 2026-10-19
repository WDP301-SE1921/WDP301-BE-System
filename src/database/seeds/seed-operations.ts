import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { attendanceContribution } from '../../modules/academic/attendance-calculation';
import type { SeedUsers } from './seed-accounts';
import type { SeedCatalog } from './seed-catalog';
import { addDays, dateOnly, demoId, localInstant } from './seed-calendar';

export async function seedOperations(
  tx: Prisma.TransactionClient,
  users: SeedUsers,
  catalog: SeedCatalog,
  today: Date,
): Promise<void> {
  for (const [index, classKey] of [
    'math-8-a',
    'physics-8-a',
    'chemistry-8-a',
    'biology-8-a',
  ].entries()) {
    const classroom = catalog.classes[classKey];
    await tx.announcement.upsert({
      where: { id: demoId(`announcement_${classKey}`) },
      update: {},
      create: {
        id: demoId(`announcement_${classKey}`),
        classId: classroom.id,
        managerId: users.manager.id,
        title: `Thông báo kiểm tra tháng - ${classroom.name}`,
        content:
          'Buổi học cuối tháng dành cho kiểm tra. Học sinh ôn các bài đã học, mang dụng cụ học tập và đến trước giờ học 10 phút. Phụ huynh theo dõi nhận xét sau khi giáo viên công bố kết quả.',
        createdAt: localInstant(addDays(today, -index - 1), 9),
      },
    });
  }
  for (const [index, status] of (
    ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DECLINED'] as const
  ).entries()) {
    const original = catalog.lessons['math-8'][index];
    let resolutionLessonId: string | null = null;
    if (status === 'RESOLVED') {
      const revision = await tx.lesson.upsert({
        where: { id: demoId('lesson_feedback_revision') },
        update: {},
        create: {
          id: demoId('lesson_feedback_revision'),
          programId: original.programId,
          designerId: users.designer.id,
          basedOnId: original.id,
          sequence: original.sequence,
          title: `${original.title} - Bổ sung ví dụ`,
          content: `${original.content}\n\n## Bổ sung sau góp ý\nCho học sinh kiểm tra từng bước và giải thích lỗi thường gặp trước khi làm bài tổng hợp.`,
          status: 'APPROVED',
          createdAt: localInstant(addDays(today, -3), 9),
        },
      });
      resolutionLessonId = revision.id;
    }
    await tx.curriculumFeedback.upsert({
      where: { id: demoId(`feedback_${status}`) },
      update: {},
      create: {
        id: demoId(`feedback_${status}`),
        lessonId: original.id,
        teacherId: users.teacher.id,
        content:
          index === 0
            ? 'Đề nghị thêm ví dụ có lời giải từng bước cho học sinh mới.'
            : 'Điều chỉnh thời lượng luyện tập và bổ sung hướng dẫn cho các lỗi thường gặp.',
        status,
        response:
          status === 'RESOLVED'
            ? 'Đã bổ sung ví dụ và duyệt bài sửa.'
            : status === 'DECLINED'
              ? 'Nội dung đã nằm trong bài ôn tập kế tiếp.'
              : null,
        resolutionLessonId,
        createdAt: localInstant(addDays(today, -7), 9),
        updatedAt: localInstant(addDays(today, -2), 9),
      },
    });
  }
  for (const [index, status] of (
    ['INVITED', 'ACCEPTED', 'APPROVED', 'REJECTED', 'REVOKED'] as const
  ).entries()) {
    const accepted =
      status === 'ACCEPTED'
        ? users['candidate-pending']
        : status === 'APPROVED'
          ? users['substitute-teacher']
          : status === 'REJECTED'
            ? users['candidate-rejected']
            : undefined;
    const invitation = await tx.accountInvitation.upsert({
      where: { id: demoId(`invitation_${status}`) },
      update: {},
      create: {
        id: demoId(`invitation_${status}`),
        email: accepted?.email ?? `candidate.${status.toLowerCase()}@edugrade.local`,
        role: 'TEACHER',
        tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
        status,
        invitedById: users.manager.id,
        acceptedUserId: accepted?.id,
        reviewedById:
          status === 'APPROVED' || status === 'REJECTED' || status === 'REVOKED'
            ? users.manager.id
            : null,
        expiresAt: localInstant(addDays(today, 7), 23),
        acceptedAt: accepted ? localInstant(addDays(today, -3), 9) : null,
        reviewedAt:
          status === 'APPROVED' || status === 'REJECTED' || status === 'REVOKED'
            ? localInstant(addDays(today, -2), 9)
            : null,
        reviewNote: status === 'REJECTED' ? 'Hồ sơ chưa đáp ứng yêu cầu phân công.' : null,
        createdAt: localInstant(addDays(today, -5 - index), 9),
      },
    });
    await tx.auditLog.upsert({
      where: { id: demoId(`audit_invitation_${status}`) },
      update: {},
      create: {
        id: demoId(`audit_invitation_${status}`),
        actorUserId: users.manager.id,
        action: `ACCOUNT_INVITATION_${status}`,
        entityType: 'AccountInvitation',
        entityId: invitation.id,
        afterData: { status },
        createdAt: invitation.reviewedAt ?? invitation.acceptedAt ?? invitation.createdAt,
      },
    });
  }
  const orders = await tx.registrationOrder.findMany({
    where: { id: { startsWith: demoId('order_') }, status: 'COMPLETED' },
    include: { payment: true },
  });
  for (const order of orders) {
    const dedupeKey = `PAYMENT_CONFIRMED:${order.id}`;
    await tx.outboxEvent.upsert({
      where: { dedupeKey },
      update: {},
      create: {
        id: demoId(`email_${order.id}`),
        eventType: 'PAYMENT_CONFIRMED',
        aggregateType: 'RegistrationOrder',
        aggregateId: order.id,
        recipient: order.parentEmail,
        subject: `EduGrade - Xác nhận thanh toán cho ${order.studentFullName}`,
        dedupeKey,
        payload: {
          text: `Dữ liệu demo: đã xác nhận thanh toán ${order.payment?.receiptNumber ?? ''}, số tiền ${order.quotedAmount.toString()} VND.`,
        },
        status: 'SENT',
        attemptCount: 1,
        nextAttemptAt: order.confirmedAt ?? localInstant(today),
        sentAt: order.confirmedAt,
        createdAt: order.confirmedAt ?? localInstant(today),
      },
    });
  }
  await tx.outboxEvent.upsert({
    where: { dedupeKey: 'demo-email-failed' },
    update: {},
    create: {
      id: demoId('email_failed'),
      eventType: 'ANNOUNCEMENT',
      aggregateType: 'Announcement',
      aggregateId: demoId('announcement_math-8-a'),
      recipient: users.parent.email,
      subject: 'EduGrade - Lịch sử gửi email lỗi',
      dedupeKey: 'demo-email-failed',
      payload: { text: 'Thông báo demo để kiểm tra màn hình lịch sử gửi email.' },
      status: 'FAILED',
      attemptCount: 5,
      maxAttempts: 5,
      nextAttemptAt: localInstant(addDays(today, -1)),
      lastError: 'Lịch sử demo: kết nối SMTP bị gián đoạn.',
      createdAt: localInstant(addDays(today, -2), 9),
    },
  });
  for (const key of ['math-8-a', 'math-8-b', 'physics-8-a'])
    await seedReport(tx, users, catalog, key, today);
}

async function seedReport(
  tx: Prisma.TransactionClient,
  users: SeedUsers,
  catalog: SeedCatalog,
  key: string,
  today: Date,
): Promise<void> {
  const id = demoId(`report_${key}`);
  if (await tx.learningReport.findUnique({ where: { id } })) return;
  const classroom = catalog.classes[key];
  const from = localInstant(catalog.from),
    to = localInstant(today, 23, 59);
  const sessions = await tx.classSession.findMany({
    where: {
      classId: classroom.id,
      startsAt: { gte: from, lte: to },
      status: { not: 'CANCELLED' },
    },
    select: { status: true },
  });
  const participants = await tx.sessionParticipant.findMany({
    where: {
      kind: 'REGULAR',
      cancelled: false,
      session: { classId: classroom.id, startsAt: { gte: from, lte: to }, status: 'COMPLETED' },
    },
    include: {
      enrollment: { include: { studentProfile: true } },
      sourceBookings: { where: { status: 'COMPLETED' } },
    },
  });
  const grades = await tx.gradeReview.findMany({
    where: {
      status: 'PUBLISHED',
      submission: {
        submittedAt: { gte: from, lte: to },
        recipient: { assignment: { classId: classroom.id } },
      },
    },
    include: {
      submission: {
        include: {
          recipient: {
            include: {
              enrollment: { include: { studentProfile: true } },
              assignment: { include: { questions: true } },
            },
          },
        },
      },
    },
  });
  const rows = new Map<
    string,
    {
      studentId: string;
      name: string;
      required: number;
      attended: number;
      attendancePercent: number | null;
      publishedGrades: number;
      averageScore: number | null;
    }
  >();
  const ensure = (student: {
    id: string;
    fullName: string;
  }): NonNullable<ReturnType<typeof rows.get>> => {
    if (!rows.has(student.id))
      rows.set(student.id, {
        studentId: student.id,
        name: student.fullName,
        required: 0,
        attended: 0,
        attendancePercent: null,
        publishedGrades: 0,
        averageScore: null,
      });
    return rows.get(student.id)!;
  };
  for (const participant of participants) {
    const student = participant.enrollment.studentProfile;
    if (!student) continue;
    const row = ensure(student),
      contribution = attendanceContribution(
        participant.attendance,
        participant.sourceBookings.length > 0,
      );
    row.required += contribution.required;
    row.attended += contribution.attended;
  }
  for (const grade of grades) {
    const recipient = grade.submission.recipient,
      student = recipient.enrollment.studentProfile;
    if (!student) continue;
    const row = ensure(student),
      max = recipient.assignment.questions.reduce((sum, question) => sum + question.maxScore, 0);
    row.averageScore =
      ((row.averageScore ?? 0) * row.publishedGrades + (grade.totalScore / max) * 100) /
      (row.publishedGrades + 1);
    row.publishedGrades++;
  }
  for (const row of rows.values()) {
    row.attendancePercent = row.required
      ? Math.round((row.attended / row.required) * 10000) / 100
      : null;
    row.averageScore = row.averageScore === null ? null : Math.round(row.averageScore * 100) / 100;
  }
  const completed = sessions.filter((session) => session.status === 'COMPLETED').length;
  await tx.learningReport.create({
    data: {
      id,
      teacherId: classroom.teacherId ?? users.teacher.id,
      classId: classroom.id,
      snapshot: {
        from: dateOnly(catalog.from),
        to: dateOnly(today),
        className: classroom.name,
        generatedAt: localInstant(today, 9).toISOString(),
        rows: [...rows.values()],
        teachingProgress: {
          totalSessions: sessions.length,
          completedSessions: completed,
          percent: sessions.length ? Math.round((completed / sessions.length) * 10000) / 100 : null,
        },
      },
      createdAt: localInstant(today, 9),
    },
  });
}
