import { Logger } from '@nestjs/common';
import { NotificationsWorker } from '../../src/modules/notifications/notifications.worker';
import type { NotificationsGateway } from '../../src/modules/notifications/notifications.gateway';
import type { DatabaseService } from '../../src/database/orm/database.service';
import type { Prisma } from '@prisma/client';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { NotificationsRepository } from '../../src/modules/notifications/notifications.repository';

describe('Notification read snapshot', () => {
  it('leaves a concurrent insertion unread and refreshes the count after commit', async () => {
    const rows: Array<{ id: string; readAt: Date | null }> = [{ id: 'old', readAt: null }];
    const tx = {
      notification: {
        findMany: jest.fn().mockResolvedValue([{ id: 'old' }]),
        updateMany: jest
          .fn()
          .mockImplementation(
            (query: { where: { id?: { in: string[] } }; data: { readAt: Date } }) => {
              // Another transaction commits after the unread snapshot, before this update.
              rows.push({ id: 'concurrent', readAt: null });
              const selected = rows.filter(
                (row) => !query.where.id || query.where.id.in.includes(row.id),
              );
              for (const row of selected) row.readAt = query.data.readAt;
              return Promise.resolve({ count: selected.length });
            },
          ),
      },
      notificationDispatch: { create: jest.fn().mockResolvedValue({ id: 'read-change' }) },
    };
    const repo = {
      db: {
        $transaction: (
          work: (client: Prisma.TransactionClient) => Promise<unknown>,
        ): Promise<unknown> => work(tx as unknown as Prisma.TransactionClient),
      },
      unread: (): Promise<number> =>
        Promise.resolve(rows.filter((row) => row.readAt === null).length),
    };
    const service = new NotificationsService(repo as unknown as NotificationsRepository);
    await expect(service.readAll('user')).resolves.toEqual({ updatedCount: 1, unreadCount: 1 });
    expect(rows.find((row) => row.id === 'concurrent')?.readAt).toBeNull();
    expect(tx.notificationDispatch.create).toHaveBeenCalledTimes(1);
  });
  it('waits for an in-flight polling batch before completing shutdown', async () => {
    jest.useFakeTimers();
    const logging = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      let release!: (rows: never[]) => void;
      const query = new Promise<never[]>((resolve) => {
        release = resolve;
      });
      const db = {
        notificationDispatch: {
          findMany: jest.fn().mockReturnValue(query),
          count: jest.fn().mockResolvedValue(0),
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };
      const worker = new NotificationsWorker(
        db as unknown as DatabaseService,
        { connectionCount: () => 0 } as unknown as NotificationsGateway,
      );
      worker.onModuleInit();
      jest.advanceTimersByTime(1000);
      let closed = false;
      const shutdown = worker.onModuleDestroy().then(() => {
        closed = true;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      release([]);
      await shutdown;
      expect(closed).toBe(true);
    } finally {
      logging.mockRestore();
      jest.useRealTimers();
    }
  });
});
