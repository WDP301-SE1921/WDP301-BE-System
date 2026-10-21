import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { DatabaseService } from '../../database/orm/database.service';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopping = false;
  private inFlight?: Promise<void>;
  private lastMetricsAt = 0;
  private readonly logger = new Logger(NotificationsWorker.name);
  constructor(
    private readonly db: DatabaseService,
    private readonly gateway: NotificationsGateway,
  ) {}
  onModuleInit(): void {
    this.stopping = false;
    this.timer = setInterval(() => {
      if (this.running || this.stopping) return;
      this.inFlight = this.processDue().catch((error: unknown) => {
        if (!this.stopping)
          this.logger.error({
            event: 'notification.worker.failed',
            error: error instanceof Error ? error.name : 'UnknownError',
          });
      });
    }, 1000);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.inFlight;
  }
  async processDue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const due: Prisma.NotificationDispatchWhereInput = {
        OR: [
          { status: 'PENDING', nextAttemptAt: { lte: now } },
          { status: 'PROCESSING', leaseExpiresAt: { lte: now } },
        ],
      };
      const rows = await this.db.notificationDispatch.findMany({
        where: due,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 100,
      });
      await Promise.all(
        rows.map(async (row) => {
          if (row.attemptCount >= row.maxAttempts) {
            await this.db.notificationDispatch.updateMany({
              where: { id: row.id, attemptCount: row.attemptCount, AND: [due] },
              data: {
                status: 'FAILED',
                leaseToken: null,
                leaseExpiresAt: null,
                lastError: 'Dispatch retry limit reached',
              },
            });
            return;
          }
          const leaseToken = randomUUID();
          const claimed = await this.db.notificationDispatch.updateMany({
            where: { id: row.id, attemptCount: row.attemptCount, AND: [due] },
            data: {
              status: 'PROCESSING',
              leaseToken,
              leaseExpiresAt: new Date(Date.now() + 30000),
              attemptCount: { increment: 1 },
            },
          });
          if (!claimed.count) return;
          try {
            await this.gateway.deliver(row.recipientUserId, row.event, row.payload as object);
            await this.db.notificationDispatch.updateMany({
              where: { id: row.id, leaseToken, status: 'PROCESSING' },
              data: {
                status: 'SENT',
                sentAt: new Date(),
                leaseToken: null,
                leaseExpiresAt: null,
                lastError: null,
              },
            });
          } catch (error) {
            const failed = row.attemptCount + 1 >= row.maxAttempts;
            await this.db.notificationDispatch.updateMany({
              where: { id: row.id, leaseToken, status: 'PROCESSING' },
              data: {
                status: failed ? 'FAILED' : 'PENDING',
                leaseToken: null,
                leaseExpiresAt: null,
                nextAttemptAt: new Date(Date.now() + Math.min(60000, 1000 * 2 ** row.attemptCount)),
                lastError: error instanceof Error ? error.name : 'UnknownError',
              },
            });
            this.logger.warn({
              event: 'notification.dispatch.retry',
              dispatchId: row.id,
              attempt: row.attemptCount + 1,
              failed,
            });
          }
        }),
      );
      if (Date.now() - this.lastMetricsAt >= 60000) {
        this.lastMetricsAt = Date.now();
        const [pending, failed, oldest] = await Promise.all([
          this.db.notificationDispatch.count({
            where: { status: { in: ['PENDING', 'PROCESSING'] } },
          }),
          this.db.notificationDispatch.count({ where: { status: 'FAILED' } }),
          this.db.notificationDispatch.findFirst({
            where: { status: { in: ['PENDING', 'PROCESSING'] } },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          }),
        ]);
        this.logger.log({
          event: 'notification.metrics',
          connections: this.gateway.connectionCount(),
          pending,
          failed,
          oldestPendingMs: oldest ? Date.now() - oldest.createdAt.getTime() : 0,
        });
      }
    } finally {
      this.running = false;
    }
  }
}
