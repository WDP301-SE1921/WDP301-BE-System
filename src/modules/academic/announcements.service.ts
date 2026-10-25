import { NotificationEventsService } from '../notifications/notification-events.service';
import type { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { pageResult } from '../../common/pagination';
import { dateTimeRange } from '../../common/list-query';
import { ClassContentQueryDto } from './academic-list.dto';
import { createHash } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { assignedTeacherWhere } from '../registration-flow/class-teacher';
import { AcademicRepository } from './academic.repository';
import { assertRule, roles, studyDate } from './academic-access.service';
import { AnnouncementDto, ReminderDto } from './academic.dto';

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly repo: AcademicRepository,
    private readonly notifications: NotificationEventsService,
  ) {}
  async create(user: AuthenticatedUser, input: AnnouncementDto): Promise<unknown> {
    roles(user, 'MANAGER');
    return this.repo.transaction(async (tx) => {
      const created = await tx.announcement.create({ data: { ...input, managerId: user.id } });
      await this.notifications.send(
        tx,
        user.id,
        'ANNOUNCEMENT',
        'CLASS',
        created.classId,
        created.title,
        created.content,
        await this.notifications.recipients.classroom(tx, created.classId),
        created.classId,
        `announcement:${created.id}`,
      );
      return created;
    });
  }
  async list(user: AuthenticatedUser, page: ClassContentQueryDto): Promise<unknown> {
    roles(user, 'MANAGER', 'TEACHER', 'PARENT');
    const where =
      user.role === 'MANAGER'
        ? {}
        : user.role === 'TEACHER'
          ? { class: assignedTeacherWhere(user.id, new Date()) }
          : {
              class: {
                OR: [
                  {
                    enrollments: {
                      some: {
                        placements: { none: {} },
                        status: 'ACTIVE' as const,
                        startDate: { lte: studyDate(new Date()) },
                        endDate: { gte: studyDate(new Date()) },
                        studentProfile: { parentProfile: { userId: user.id } },
                      },
                    },
                  },
                  {
                    placements: {
                      some: {
                        effectiveFrom: { lte: new Date() },
                        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
                        enrollment: {
                          status: 'ACTIVE' as const,
                          startDate: { lte: studyDate(new Date()) },
                          endDate: { gte: studyDate(new Date()) },
                          studentProfile: { parentProfile: { userId: user.id } },
                        },
                      },
                    },
                  },
                ],
              },
            };
    const filtered = { AND: [where, {
      ...(page.classId ? { classId: page.classId } : {}),
      ...(page.search ? { OR: [{ title: { contains: page.search } }, { body: { contains: page.search } }] } : {}),
      createdAt: dateTimeRange(page.fromDate, page.toDate),
    }] };
    return pageResult(page, this.repo.db.announcement.findMany({
      where: filtered,
      take: page.limit,
      skip: (page.page - 1) * page.limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    }), () => this.repo.db.announcement.count({ where: filtered }));
  }
  async sendAnnouncement(user: AuthenticatedUser, id: string): Promise<unknown> {
    roles(user, 'MANAGER');
    const announcement = await this.repo.db.announcement.findUniqueOrThrow({ where: { id } });
    const now = new Date();
    const enrollments = await this.repo.db.enrollment.findMany({
      where: {
        status: 'ACTIVE',
        startDate: { lte: studyDate(now) },
        endDate: { gte: studyDate(now) },
        OR: [
          {
            placements: {
              some: {
                classId: announcement.classId,
                effectiveFrom: { lte: now },
                OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
              },
            },
          },
          { placements: { none: {} }, classId: announcement.classId },
        ],
      },
      include: { studentProfile: { include: { parentProfile: { include: { user: true } } } } },
      take: 1001,
    });
    assertRule(
      enrollments.length <= 1000,
      'TOO_MANY_RECIPIENTS',
      'Limit each announcement to 1000 enrollments',
    );
    return this.enqueue(
      'ANNOUNCEMENT',
      announcement.id,
      [
        ...new Set(
          enrollments.flatMap((e) =>
            e.studentProfile ? [e.studentProfile.parentProfile.user.email] : [],
          ),
        ),
      ].map((email) => ({ email, title: announcement.title, content: announcement.content })),
    );
  }
  async reminders(user: AuthenticatedUser, input: ReminderDto): Promise<unknown> {
    roles(user, 'MANAGER');
    const from = studyDate(new Date()),
      to = new Date(input.through);
    assertRule(
      to >= from && to.getTime() - from.getTime() <= 31 * 86400000,
      'INVALID_REMINDER_RANGE',
      'Choose a date within the next 31 days',
    );
    const rows = await this.repo.db.enrollment.findMany({
      where: { status: 'ACTIVE', endDate: { gte: from, lte: to } },
      include: {
        class: true,
        studentProfile: { include: { parentProfile: { include: { user: true } } } },
      },
      take: 1001,
    });
    assertRule(rows.length <= 1000, 'TOO_MANY_RECIPIENTS', 'Reduce the reminder range');
    return this.enqueue(
      'TUITION_REMINDER',
      input.through,
      rows.flatMap((e) =>
        e.studentProfile
          ? [
              {
                email: e.studentProfile.parentProfile.user.email,
                title: 'EduGrade - Nhắc gia hạn học phí',
                content: `${e.studentProfile.fullName}: lớp ${e.class.name}. Khóa học kết thúc ngày ${e.endDate!.toISOString().slice(0, 10)}. Vui lòng liên hệ trung tâm để gia hạn.`,
              },
            ]
          : [],
      ),
      async (tx) => {
        for (const row of rows) {
          const scope = await this.notifications.recipients.family(tx, row.id, false);
          await this.notifications.send(
            tx,
            user.id,
            'TUITION_REMINDER',
            'ENROLLMENT',
            row.id,
            'Nhắc gia hạn học phí',
            `Kỳ học lớp ${row.class.name} sắp kết thúc; vui lòng liên hệ trung tâm để gia hạn.`,
            scope.recipients,
            row.classId,
            `tuition:${row.id}:${input.through}`,
          );
        }
      },
    );
  }
  private async enqueue(
    eventType: string,
    aggregateId: string,
    messages: { email: string; title: string; content: string }[],
    notify?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<unknown> {
    await this.repo.transaction(async (tx) => {
      await tx.outboxEvent.createMany({
        data: messages.map((message) => ({
          eventType,
          aggregateType: eventType === 'ANNOUNCEMENT' ? 'Announcement' : 'TuitionReminder',
          aggregateId,
          recipient: message.email,
          subject: message.title,
          dedupeKey: `${eventType}:${aggregateId}:${createHash('sha256')
            .update(message.email + message.content)
            .digest('hex')}`,
          payload: { text: message.content },
        })),
        skipDuplicates: true,
      });
      if (notify) await notify(tx);
    });
    return {
      results: messages.map((message) => ({ email: message.email, queued: true })),
      automaticRetry: true,
    };
  }
}
