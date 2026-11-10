import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import type { AppConfiguration } from '../../config/configuration';
import { DatabaseService } from '../../database/orm/database.service';
import { CENTER_PROFILE_ID } from '../center/center-profile';
import { requireAdmin } from './admin-rules';
import { emailServiceState } from './admin-rules';
import type { UpdateCenterDto } from './dto/admin.dto';

const DAY_MS = 86_400_000;
const HCM_OFFSET_MS = 7 * 3_600_000;
const CENTER_FIELDS = ['name', 'address', 'phone', 'email', 'openingHours'] as const;
type CenterField = (typeof CENTER_FIELDS)[number];

/** Đầu tháng hiện tại theo giờ Việt Nam, đổi về UTC. */
export function startOfVietnamMonth(now: Date): Date {
  const local = new Date(now.getTime() + HCM_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - HCM_OFFSET_MS);
}

@Injectable()
export class AdminSystemService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<AppConfiguration, true>,
  ) {}

  /** Chỉ số toàn hệ thống cho màn Tổng quan. */
  async overview(user: AuthenticatedUser): Promise<unknown> {
    requireAdmin(user);
    const [
      byStatus,
      managerAccounts,
      activeClasses,
      activeEnrollments,
      pendingCurriculum,
      paidThisMonth,
      pendingPayments,
      failedEmails,
      pendingInvitations,
    ] = await Promise.all([
      this.db.user.groupBy({ by: ['status'], _count: { _all: true } }),
      this.db.user.count({ where: { role: 'MANAGER' } }),
      this.db.class.count({ where: { isActive: true } }),
      this.db.enrollment.count({ where: { status: 'ACTIVE' } }),
      this.db.curriculumUnit.count({ where: { status: 'PENDING_REVIEW' } }),
      this.db.payment.aggregate({
        where: { confirmedAt: { gte: startOfVietnamMonth(new Date()) } },
        _sum: { amount: true },
      }),
      this.db.registrationOrder.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { quotedAmount: true },
        _count: { _all: true },
      }),
      this.db.outboxEvent.count({ where: { status: 'FAILED' } }),
      this.db.accountInvitation.count({ where: { role: 'MANAGER', status: 'INVITED' } }),
    ]);
    const count = (status: string): number =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;
    return {
      totalAccounts: byStatus.reduce((sum, row) => sum + row._count._all, 0),
      activeAccounts: count('ACTIVE'),
      disabledAccounts: count('DISABLED'),
      managerAccounts,
      activeClasses,
      enrolledStudents: activeEnrollments,
      pendingCurriculum,
      tuitionThisMonth: Number(paidThisMonth._sum.amount ?? 0),
      pendingPayments: pendingPayments._count._all,
      pendingPaymentAmount: Number(pendingPayments._sum.quotedAmount ?? 0),
      failedEmails,
      pendingInvitations,
    };
  }

  /** Trạng thái dịch vụ. Chỉ trả có / chưa cấu hình, không trả URL, khóa hay mật khẩu. */
  async services(user: AuthenticatedUser): Promise<unknown> {
    requireAdmin(user);
    const checkedAt = new Date();
    const academic = this.config.get('academic', { infer: true });
    const [databaseUp, failedLastDay] = await Promise.all([
      this.db.isReady(),
      this.db.outboxEvent.count({
        where: { status: 'FAILED', createdAt: { gte: new Date(checkedAt.getTime() - DAY_MS) } },
      }),
    ]);
    const smtp = Boolean(academic.smtpUrl);
    const storage = Boolean(academic.storageBucket && academic.storageEndpoint);
    const ai = Boolean(academic.aiKey);
    return [
      {
        id: 'api',
        name: 'API',
        status: 'AVAILABLE',
        description: 'Máy chủ đang trả lời yêu cầu.',
      },
      {
        id: 'database',
        name: 'Cơ sở dữ liệu',
        status: databaseUp ? 'AVAILABLE' : 'DEGRADED',
        description: databaseUp ? 'Kết nối ổn định.' : 'Không kết nối được cơ sở dữ liệu.',
      },
      {
        id: 'email',
        name: 'Email',
        status: emailServiceState(smtp, failedLastDay),
        description: smtp
          ? `${failedLastDay} email gửi lỗi trong 24 giờ qua.`
          : 'Chưa cấu hình máy chủ gửi thư.',
      },
      {
        id: 'ai',
        name: 'AI',
        status: ai ? 'AVAILABLE' : 'NOT_CONFIGURED',
        description: ai ? 'Đã cấu hình dịch vụ AI.' : 'Chưa cấu hình dịch vụ AI.',
      },
      {
        id: 'storage',
        name: 'Lưu trữ tệp',
        status: storage ? 'AVAILABLE' : 'NOT_CONFIGURED',
        description: storage ? 'Đã cấu hình kho lưu trữ.' : 'Chưa cấu hình kho lưu trữ.',
      },
    ].map((service) => ({ ...service, checkedAt }));
  }

  async updateCenter(user: AuthenticatedUser, input: UpdateCenterDto): Promise<unknown> {
    requireAdmin(user);
    const data = Object.fromEntries(
      CENTER_FIELDS.map((field) => [field, input[field] ?? null]),
    ) as Record<CenterField, string | null>;
    return this.db.$transaction(async (tx) => {
      const before = await tx.centerProfile.findUnique({ where: { id: CENTER_PROFILE_ID } });
      const after = await tx.centerProfile.upsert({
        where: { id: CENTER_PROFILE_ID },
        create: { id: CENTER_PROFILE_ID, ...data },
        update: data,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'CENTER_PROFILE_UPDATE',
          entityType: 'CenterProfile',
          entityId: CENTER_PROFILE_ID,
          ...(before
            ? { beforeData: Object.fromEntries(CENTER_FIELDS.map((f) => [f, before[f]])) }
            : {}),
          afterData: data,
        },
      });
      return Object.fromEntries(CENTER_FIELDS.map((field) => [field, after[field]]));
    });
  }
}
