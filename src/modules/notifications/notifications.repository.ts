import { Injectable } from '@nestjs/common';
import { dateTimeRange } from '../../common/list-query';
import type { Notification, Prisma } from '@prisma/client';
import { DatabaseService } from '../../database/orm/database.service';
import type {
  NotificationItemDto,
  NotificationPageDto,
  NotificationQueryDto,
} from './notifications.dto';

export function notificationItem(row: Notification): NotificationItemDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    target: { kind: row.targetKind, id: row.targetId },
    context: {
      ...(row.classId ? { classId: row.classId } : {}),
      studentIds: row.studentIds as string[],
    },
    createdAt: row.createdAt,
    readAt: row.readAt,
  };
}
@Injectable()
export class NotificationsRepository {
  constructor(readonly db: DatabaseService) {}
  async list(userId: string, query: NotificationQueryDto): Promise<NotificationPageDto> {
    const where: Prisma.NotificationWhereInput = {
      recipientUserId: userId,
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.search ? { OR: [{ title: { contains: query.search.trim() } }, { body: { contains: query.search.trim() } }] } : {}),
      ...(query.fromDate || query.toDate ? { createdAt: dateTimeRange(query.fromDate, query.toDate) } : {}),
      ...(query.unreadOnly ? { readAt: null } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.studentId ? { studentIds: { array_contains: [query.studentId] } } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.notification.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.db.notification.count({ where }),
    ]);
    return { items: items.map(notificationItem), total, page: query.page, limit: query.limit };
  }
  unread(userId: string, tx: Prisma.TransactionClient = this.db): Promise<number> {
    return tx.notification.count({ where: { recipientUserId: userId, readAt: null } });
  }
}
