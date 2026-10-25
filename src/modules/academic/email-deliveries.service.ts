import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors/app.error';
import { dateTimeRange } from '../../common/list-query';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import type { AppConfiguration } from '../../config/configuration';
import { DatabaseService } from '../../database/orm/database.service';
import { assertRule, roles } from './academic-access.service';
import type { EmailDeliveryFilterDto } from './academic.dto';

@Injectable()
export class EmailDeliveriesService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(EmailDeliveriesService.name);
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<AppConfiguration, true>,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.processDue().catch((error: unknown) => {
        this.logger.error(
          `Email delivery worker failed: ${error instanceof Error ? error.name : 'UnknownError'}`,
        );
      });
    }, 30_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async list(user: AuthenticatedUser, page: EmailDeliveryFilterDto): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF');
    const where = {
      ...(page.status ? { status: page.status } : {}),
      ...(page.eventType ? { eventType: page.eventType } : {}),
      ...(page.search ? { recipient: { contains: page.search.trim() } } : {}),
      ...(page.fromDate || page.toDate ? { createdAt: dateTimeRange(page.fromDate, page.toDate) } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.outboxEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        omit: { payload: true },
        skip: (page.page - 1) * page.limit,
        take: page.limit,
      }),
      this.db.outboxEvent.count({ where }),
    ]);
    return { items, page: page.page, limit: page.limit, total };
  }

  async retry(user: AuthenticatedUser, id: string): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF');
    return this.deliver(id);
  }

  private async processDue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const events = await this.db.outboxEvent.findMany({
        where: {
          OR: [
            { status: 'PENDING', nextAttemptAt: { lte: now } },
            { status: 'PROCESSING', leaseExpiresAt: { lte: now } },
          ],
        },
        select: { id: true, attemptCount: true, maxAttempts: true },
        take: 20,
      });
      await Promise.allSettled(
        events.map(async (event) => {
          if (event.attemptCount >= event.maxAttempts) {
            await this.db.outboxEvent.updateMany({
              where: {
                id: event.id,
                OR: [{ status: 'PENDING' }, { status: 'PROCESSING', leaseExpiresAt: { lte: now } }],
              },
              data: { status: 'FAILED', leaseToken: null, leaseExpiresAt: null },
            });
          } else {
            await this.deliver(event.id);
          }
        }),
      );
    } finally {
      this.running = false;
    }
  }

  private async deliver(id: string): Promise<unknown> {
    const event = await this.db.outboxEvent.findUnique({ where: { id } });
    assertRule(event, 'EMAIL_DELIVERY_NOT_FOUND', 'Email delivery not found', HttpStatus.NOT_FOUND);
    assertRule(event.status !== 'SENT', 'EMAIL_ALREADY_SENT', 'Email was already sent');
    if (event.eventType === 'ACCOUNT_INVITATION') {
      const payload = event.payload as { tokenHash?: string };
      const invitation = await this.db.accountInvitation.findUnique({
        where: { id: event.aggregateId },
        select: { tokenHash: true, status: true, expiresAt: true },
      });
      if (
        !invitation ||
        invitation.status !== 'INVITED' ||
        invitation.expiresAt <= new Date() ||
        invitation.tokenHash !== payload.tokenHash
      ) {
        await this.db.outboxEvent.updateMany({
          where: { id, status: { in: ['PENDING', 'FAILED'] } },
          data: { status: 'FAILED', lastError: 'Invitation token was replaced or expired' },
        });
        throw new AppError(
          'INVITATION_INVALID',
          'Invitation is invalid or expired',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    if (event.eventType === 'PASSWORD_RESET' || event.eventType === 'EMAIL_VERIFICATION') {
      const payload = event.payload as { tokenHash?: string };
      const record =
        event.eventType === 'PASSWORD_RESET'
          ? await this.db.passwordResetToken.findUnique({ where: { id: event.aggregateId } })
          : await this.db.emailVerificationToken.findUnique({ where: { id: event.aggregateId } });
      if (
        !record ||
        record.usedAt ||
        record.expiresAt <= new Date() ||
        record.tokenHash !== payload.tokenHash
      ) {
        await this.db.outboxEvent.updateMany({
          where: { id, status: { in: ['PENDING', 'FAILED'] } },
          data: { status: 'FAILED', lastError: 'Account token was used or expired' },
        });
        throw new AppError(
          'ACCOUNT_TOKEN_INVALID',
          'Account token is invalid or expired',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    assertRule(
      event.attemptCount < event.maxAttempts,
      'EMAIL_RETRY_EXHAUSTED',
      'Email retry limit was reached',
    );
    const academic = this.config.get('academic', { infer: true });
    assertRule(
      academic.smtpUrl && academic.mailFrom,
      'EMAIL_NOT_CONFIGURED',
      'SMTP is not configured',
    );
    const leaseToken = randomUUID();
    const claimed = await this.db.outboxEvent.updateMany({
      where: {
        id,
        attemptCount: event.attemptCount,
        OR: [
          { status: { in: ['PENDING', 'FAILED'] } },
          { status: 'PROCESSING', leaseExpiresAt: { lte: new Date() } },
        ],
      },
      data: {
        status: 'PROCESSING',
        attemptCount: { increment: 1 },
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    assertRule(claimed.count === 1, 'EMAIL_DELIVERY_BUSY', 'Email delivery is already processing');
    const transport = createTransport(
      {
        url: academic.smtpUrl,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      },
      { from: academic.mailFrom },
    );
    try {
      const payload = event.payload as { text?: string; html?: string };
      await transport.sendMail({
        to: event.recipient,
        subject: event.subject,
        text: payload.text,
        html: payload.html,
      });
      await this.db.outboxEvent.updateMany({
        where: { id, leaseToken, status: 'PROCESSING' },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          lastError: null,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      return { id, status: 'SENT' };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 2000) : 'Unknown SMTP error';
      const attempt = event.attemptCount + 1;
      await this.db.outboxEvent.updateMany({
        where: { id, leaseToken, status: 'PROCESSING' },
        data: {
          status: attempt >= event.maxAttempts ? 'FAILED' : 'PENDING',
          lastError: message,
          nextAttemptAt: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** attempt)),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      throw new AppError('EMAIL_DELIVERY_FAILED', 'Email delivery failed', HttpStatus.BAD_GATEWAY);
    } finally {
      transport.close();
    }
  }
}
