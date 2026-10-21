import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { NotificationTargetKind, Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app.error';
import { NotificationsRepository, notificationItem } from './notifications.repository';
import type { NotificationItemDto } from './notifications.dto';
import type { NotificationType } from './notifications.dto';

export interface NotificationRecipient {
  userId: string;
  studentIds?: string[];
}
export interface NotificationInput {
  eventKey: string;
  type: NotificationType;
  actorId: string;
  title: string;
  body: string;
  targetKind: NotificationTargetKind;
  targetId: string;
  classId?: string;
  recipients: NotificationRecipient[];
}
@Injectable()
export class NotificationsService {
  constructor(private readonly repo: NotificationsRepository) {}

  async record(tx: Prisma.TransactionClient, input: NotificationInput): Promise<void> {
    const grouped = new Map<string, Set<string>>();
    for (const recipient of input.recipients) {
      if (recipient.userId === input.actorId) continue;
      const students = grouped.get(recipient.userId) ?? new Set<string>();
      for (const id of recipient.studentIds ?? []) students.add(id);
      grouped.set(recipient.userId, students);
    }
    if (!grouped.size) return;
    const users = await tx.user.findMany({
      where: { id: { in: [...grouped.keys()] }, status: 'ACTIVE' },
      select: { id: true },
    });
    for (const user of users) {
      const studentIds = [...grouped.get(user.id)!].sort();
      const dedupeKey = createHash('sha256')
        .update(
          JSON.stringify([input.eventKey, input.type, user.id, input.classId ?? null, studentIds]),
        )
        .digest('hex');
      const id = randomUUID();
      const inserted = await tx.notification.createMany({
        data: [
          {
            id,
            recipientUserId: user.id,
            type: input.type,
            title: input.title.slice(0, 255),
            body: input.body,
            targetKind: input.targetKind,
            targetId: input.targetId,
            classId: input.classId,
            studentIds,
            dedupeKey,
          },
        ],
        skipDuplicates: true,
      });
      if (!inserted.count) continue;
      await tx.notificationDispatch.create({
        data: {
          recipientUserId: user.id,
          event: 'notification.created',
          payload: { notificationId: id },
        },
      });
    }
  }
  async read(userId: string, id: string): Promise<NotificationItemDto> {
    return this.repo.db.$transaction(async (tx) => {
      const found = await tx.notification.findFirst({ where: { id, recipientUserId: userId } });
      if (!found)
        throw new AppError(
          'NOTIFICATION_NOT_FOUND',
          'Notification not found',
          HttpStatus.NOT_FOUND,
        );
      const changed = await tx.notification.updateMany({
        where: { id, recipientUserId: userId, readAt: null },
        data: { readAt: new Date() },
      });
      if (changed.count) await this.readDispatch(tx, userId);
      return notificationItem(await tx.notification.findUniqueOrThrow({ where: { id } }));
    });
  }
  async readAll(userId: string): Promise<{ updatedCount: number; unreadCount: number }> {
    const updatedCount = await this.repo.db.$transaction(
      async (tx) => {
        // Freeze the set first: notifications inserted after this snapshot remain unread.
        const rows = await tx.notification.findMany({
          where: { recipientUserId: userId, readAt: null },
          select: { id: true },
        });
        let updatedCount = 0;
        const readAt = new Date();
        for (let start = 0; start < rows.length; start += 1000) {
          const changed = await tx.notification.updateMany({
            where: {
              recipientUserId: userId,
              id: { in: rows.slice(start, start + 1000).map((row) => row.id) },
              readAt: null,
            },
            data: { readAt },
          });
          updatedCount += changed.count;
        }
        if (updatedCount) await this.readDispatch(tx, userId);
        return updatedCount;
      },
      { timeout: 20000 },
    );
    return { updatedCount, unreadCount: await this.repo.unread(userId) };
  }
  private async readDispatch(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.notificationDispatch.create({
      data: { recipientUserId: userId, event: 'notifications.read-changed', payload: {} },
    });
  }
}
