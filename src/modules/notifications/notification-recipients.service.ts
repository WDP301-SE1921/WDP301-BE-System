import { Injectable } from '@nestjs/common';
import type { Prisma, UserRole } from '@prisma/client';
import { studyDate } from '../academic/academic-access.service';
import { assignedTeacherAt } from '../registration-flow/class-teacher';
import type { NotificationRecipient } from './notifications.service';

type SessionScope = { id: string; classId: string; startsAt: Date; teacherId: string };
function sessionEnrollment(session: SessionScope): Prisma.EnrollmentWhereInput {
  return {
    status: { not: 'PENDING_LINK' },
    AND: [
      {
        OR: [
          { status: { not: 'ENDED' } },
          { endedAt: null },
          { endedAt: { gt: session.startsAt } },
        ],
      },
    ],
    OR: [
      { participants: { some: { sessionId: session.id, cancelled: false } } },
      {
        startDate: { lte: studyDate(session.startsAt) },
        endDate: { gt: studyDate(session.startsAt) },
        participants: { none: { sessionId: session.id, cancelled: true } },
        OR: [
          { placements: { none: {} }, classId: session.classId },
          {
            placements: {
              some: {
                classId: session.classId,
                effectiveFrom: { lte: session.startsAt },
                OR: [{ effectiveTo: null }, { effectiveTo: { gt: session.startsAt } }],
              },
            },
          },
        ],
      },
    ],
  };
}
@Injectable()
export class NotificationRecipientsService {
  async roles(tx: Prisma.TransactionClient, roles: UserRole[]): Promise<NotificationRecipient[]> {
    return (
      await tx.user.findMany({
        where: { role: { in: roles }, status: 'ACTIVE' },
        select: { id: true },
      })
    ).map((row) => ({ userId: row.id }));
  }
  async family(
    tx: Prisma.TransactionClient,
    enrollmentId: string,
    teachers = true,
  ): Promise<{ recipients: NotificationRecipient[]; classId: string; studentId?: string }> {
    const enrollment = await tx.enrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
      include: {
        studentProfile: { select: { id: true, parentProfile: { select: { userId: true } } } },
        class: true,
        placements: {
          where: {
            effectiveFrom: { lte: new Date() },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
          },
          include: { class: true },
        },
      },
    });
    const lastPlacement =
      enrollment.status === 'ENDED' && !enrollment.placements.length
        ? await tx.enrollmentPlacement.findFirst({
            where: { enrollmentId, effectiveFrom: { lte: new Date() } },
            orderBy: { effectiveFrom: 'desc' },
            include: { class: true },
          })
        : null;
    const classroom = enrollment.placements[0]?.class ?? lastPlacement?.class ?? enrollment.class;
    const recipients: NotificationRecipient[] = [];
    const student = enrollment.studentProfile;
    if (student)
      recipients.push({ userId: student.parentProfile.userId, studentIds: [student.id] });
    const teacher = assignedTeacherAt(classroom, new Date());
    if (teachers && teacher)
      recipients.push({ userId: teacher, studentIds: student ? [student.id] : [] });
    return { recipients, classId: classroom.id, studentId: student?.id };
  }
  async sessions(
    tx: Prisma.TransactionClient,
    sessions: SessionScope[],
  ): Promise<NotificationRecipient[]> {
    if (!sessions.length) return [];
    const rows = await tx.enrollment.findMany({
      where: { OR: sessions.map(sessionEnrollment) },
      select: {
        studentProfile: { select: { id: true, parentProfile: { select: { userId: true } } } },
      },
    });
    return [
      ...sessions.map((session) => ({ userId: session.teacherId })),
      ...rows.flatMap((row) =>
        row.studentProfile
          ? [
              {
                userId: row.studentProfile.parentProfile.userId,
                studentIds: [row.studentProfile.id],
              },
            ]
          : [],
      ),
    ];
  }
  async classroom(tx: Prisma.TransactionClient, classId: string): Promise<NotificationRecipient[]> {
    const now = new Date();
    const classroom = await tx.class.findUniqueOrThrow({ where: { id: classId } });
    const rows = await tx.enrollment.findMany({
      where: {
        status: 'ACTIVE',
        startDate: { lte: studyDate(now) },
        endDate: { gt: studyDate(now) },
        OR: [
          { classId, placements: { none: {} } },
          {
            placements: {
              some: {
                classId,
                effectiveFrom: { lte: now },
                OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
              },
            },
          },
        ],
      },
      select: {
        studentProfile: { select: { id: true, parentProfile: { select: { userId: true } } } },
      },
    });
    const teacherId = assignedTeacherAt(classroom, now);
    return [
      ...(teacherId ? [{ userId: teacherId }] : []),
      ...rows.flatMap((row) =>
        row.studentProfile
          ? [
              {
                userId: row.studentProfile.parentProfile.userId,
                studentIds: [row.studentProfile.id],
              },
            ]
          : [],
      ),
    ];
  }
}
