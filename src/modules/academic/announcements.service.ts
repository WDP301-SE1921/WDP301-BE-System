import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { AppConfiguration } from '../../config/configuration';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AcademicRepository } from './academic.repository';
import { assertRule, roles, studyDate } from './academic-access.service';
import { AnnouncementDto, PageDto, ReminderDto } from './academic.dto';

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly repo: AcademicRepository,
    private readonly config: ConfigService<AppConfiguration, true>,
  ) {}
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
          ? { class: { teacherId: user.id } }
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
    return this.deliver(
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
    return this.deliver(
      rows.flatMap((e) =>
        e.studentProfile
          ? [
              {
                email: e.studentProfile.parentProfile.user.email,
                title: 'EduGrade - Tuition reminder',
                content: `${e.studentProfile.fullName}: ${e.class.name}. Enrollment ends on ${e.endDate!.toISOString().slice(0, 10)}. Please contact the center to renew.`,
              },
            ]
          : [],
      ),
    );
  }
  private async deliver(
    messages: { email: string; title: string; content: string }[],
  ): Promise<unknown> {
    const c = this.config.get('academic', { infer: true });
    if (!c.smtpUrl || !c.mailFrom) throw new ServiceUnavailableException('SMTP is not configured');
    const transport = createTransport(
      { url: c.smtpUrl, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 },
      { from: c.mailFrom },
    );
    const results: { email: string; sent: boolean }[] = [];
    try {
      for (const message of messages) {
        try {
          await transport.sendMail({
            to: message.email,
            subject: message.title,
            text: message.content,
          });
          results.push({ email: message.email, sent: true });
        } catch {
          results.push({ email: message.email, sent: false });
        }
      }
    } finally {
      transport.close();
    }
    return { results, automaticRetry: false };
  }
}
