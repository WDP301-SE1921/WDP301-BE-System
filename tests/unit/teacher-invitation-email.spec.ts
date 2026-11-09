import type { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import type { AppConfiguration } from '../../src/config/configuration';
import type { DatabaseService } from '../../src/database/orm/database.service';
import { EmailDeliveriesService } from '../../src/modules/academic/email-deliveries.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
type AsyncMock = jest.Mock<Promise<unknown>, unknown[]>;
interface MailDatabase {
  outboxEvent: { findUnique: AsyncMock; updateMany: AsyncMock };
  accountInvitation: { findUnique: AsyncMock };
}

describe('Historical teacher invitation email suppression', () => {
  const sendMail = jest.fn().mockResolvedValue({});
  beforeEach(() => {
    jest.clearAllMocks();
    (createTransport as jest.Mock).mockReturnValue({ sendMail, close: jest.fn() });
  });
  const setup = (
    role: 'TEACHER' | 'MANAGER',
    status = 'PENDING',
  ): { db: MailDatabase; service: EmailDeliveriesService } => {
    const db = {
      outboxEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'mail-1',
          aggregateId: 'invite-1',
          eventType: 'ACCOUNT_INVITATION',
          status,
          attemptCount: 0,
          maxAttempts: 5,
          leaseToken: status === 'PROCESSING' ? 'stale-lease' : null,
          leaseExpiresAt: status === 'PROCESSING' ? new Date(Date.now() - 1000) : null,
          payload: { tokenHash: 'hash', text: 'Historical invitation' },
          recipient: 'candidate@example.com',
          subject: 'Invitation',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      accountInvitation: {
        findUnique: jest.fn().mockResolvedValue({
          role,
          status: 'INVITED',
          tokenHash: 'hash',
          expiresAt: new Date(Date.now() + 3600000),
        }),
      },
    };
    const service = new EmailDeliveriesService(
      db as unknown as DatabaseService,
      {
        get: () => ({ smtpUrl: 'smtp://localhost:1025', mailFrom: 'test@example.com' }),
      } as unknown as ConfigService<AppConfiguration, true>,
    );
    return { db, service };
  };

  it.each(['PENDING', 'FAILED', 'PROCESSING'])(
    'blocks a %s teacher mail before SMTP and stops stale lease retries',
    async (status) => {
      const { db, service } = setup('TEACHER', status);
      await expect(
        service.retry({ role: 'MANAGER' } as AuthenticatedUser, 'mail-1'),
      ).rejects.toMatchObject({ code: 'TEACHER_INVITATION_DISABLED', statusCode: 410 });
      expect(createTransport).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
      expect(db.outboxEvent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            status: 'FAILED',
            lastError: 'TEACHER_INVITATION_DISABLED',
            leaseToken: null,
            leaseExpiresAt: null,
          },
        }),
      );
    },
  );

  it('still delivers a valid manager invitation', async () => {
    const { service } = setup('MANAGER');
    await expect(
      service.retry({ role: 'MANAGER' } as AuthenticatedUser, 'mail-1'),
    ).resolves.toEqual({ id: 'mail-1', status: 'SENT' });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'candidate@example.com', text: 'Historical invitation' }),
    );
  });
});
