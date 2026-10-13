import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { assignedTeacherWhere } from '../registration-flow/class-teacher';
import { AcademicRepository } from './academic.repository';
import { assertRule, roles, studyDate } from './academic-access.service';
import { AnnouncementDto, PageDto, ReminderDto } from './academic.dto';

@Injectable()
export class AnnouncementsService {
  constructor(private readonly repo: AcademicRepository) {}
  async create(user: AuthenticatedUser, input: AnnouncementDto): Promise<unknown> {
    roles(user, 'MANAGER');
    return this.repo.db.announcement.create({ data: { ...input, managerId: user.id } });
  }
  async list(user: AuthenticatedUser, page: PageDto): Promise<unknown> {
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
    return this.repo.db.announcement.findMany({
      where,
      take: page.limit,
      skip: (page.page - 1) * page.limit,
      orderBy: { createdAt: 'desc' },
    });
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
    );
  }
  private async enqueue(
    eventType: string,
    aggregateId: string,
    messages: { email: string; title: string; content: string }[],
  ): Promise<unknown> {
    await this.repo.db.outboxEvent.createMany({
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
    return {
      results: messages.map((message) => ({ email: message.email, queued: true })),
      automaticRetry: true,
    };
  }
}
