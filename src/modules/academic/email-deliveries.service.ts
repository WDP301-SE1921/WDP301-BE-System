import { HttpStatus, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import type { AppConfiguration } from '../../config/configuration';
import { DatabaseService } from '../../database/orm/database.service';
import { assertRule, roles } from './academic-access.service';
import type { PageDto } from './academic.dto';

@Injectable()
export class EmailDeliveriesService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<AppConfiguration, true>,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.processDue(), 30_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async list(user: AuthenticatedUser, page: PageDto): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF');
    const [items, total] = await Promise.all([
      this.db.outboxEvent.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page.page - 1) * page.limit,
        take: page.limit,
      }),
      this.db.outboxEvent.count(),
    ]);
    return { items, page: page.page, limit: page.limit, total };
  }

  async retry(user: AuthenticatedUser, id: string): Promise<unknown> {
    roles(user, 'MANAGER', 'STAFF');
    return this.deliver(id);
  }

  private async processDue(): Promise<void> {
    const events = await this.db.outboxEvent.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() }, attemptCount: { lt: 5 } },
      select: { id: true },
      take: 20,
    });
    await Promise.allSettled(events.map((event) => this.deliver(event.id)));
  }

  private async deliver(id: string): Promise<unknown> {
    const event = await this.db.outboxEvent.findUnique({ where: { id } });
    assertRule(event, 'EMAIL_DELIVERY_NOT_FOUND', 'Email delivery not found', HttpStatus.NOT_FOUND);
    assertRule(event.status !== 'SENT', 'EMAIL_ALREADY_SENT', 'Email was already sent');
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
    const claimed = await this.db.outboxEvent.updateMany({
      where: { id, status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'PROCESSING', attemptCount: { increment: 1 } },
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
      return await this.db.outboxEvent.update({
        where: { id },
        data: { status: 'SENT', sentAt: new Date(), lastError: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 2000) : 'Unknown SMTP error';
      const attempt = event.attemptCount + 1;
      await this.db.outboxEvent.update({
        where: { id },
        data: {
          status: attempt >= event.maxAttempts ? 'FAILED' : 'PENDING',
          lastError: message,
          nextAttemptAt: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** attempt)),
        },
      });
      throw error;
    } finally {
      transport.close();
    }
  }
}
