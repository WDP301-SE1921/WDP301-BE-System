import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import * as webPush from 'web-push';
import type { AppConfiguration } from '../../config/configuration';
import { DatabaseService } from '../../database/orm/database.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import type {
  PushPublicKeyDto,
  PushSubscriptionResultDto,
  SavePushSubscriptionDto,
} from './push-notifications.dto';

function endpointHash(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

function chatPath(role: string): string {
  if (role === 'TEACHER') return '/teacher/chat';
  if (role === 'STAFF') return '/staff/chat';
  return '/manager/chat';
}

@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);
  private readonly publicKey: string;
  private readonly enabled: boolean;

  constructor(
    private readonly db: DatabaseService,
    config: ConfigService<AppConfiguration, true>,
  ) {
    const settings = config.get('webPush', { infer: true });
    this.publicKey = settings.publicKey;
    this.enabled = Boolean(settings.publicKey && settings.privateKey);
    if (this.enabled) {
      webPush.setVapidDetails(settings.subject, settings.publicKey, settings.privateKey);
    }
  }

  settings(): PushPublicKeyDto {
    return { enabled: this.enabled, publicKey: this.enabled ? this.publicKey : '' };
  }

  async save(
    user: AuthenticatedUser,
    input: SavePushSubscriptionDto,
  ): Promise<PushSubscriptionResultDto> {
    if (!this.enabled) return { subscribed: false };
    const hash = endpointHash(input.endpoint);
    await this.db.pushSubscription.upsert({
      where: { endpointHash: hash },
      create: {
        userId: user.id,
        endpointHash: hash,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
      update: {
        userId: user.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
    });
    return { subscribed: true };
  }

  async remove(userId: string, endpoint: string): Promise<PushSubscriptionResultDto> {
    await this.db.pushSubscription.deleteMany({
      where: { userId, endpointHash: endpointHash(endpoint) },
    });
    return { subscribed: false };
  }

  async deliver(userId: string, notificationId: string): Promise<void> {
    if (!this.enabled) return;
    const [notification, subscriptions] = await Promise.all([
      this.db.notification.findFirst({
        where: { id: notificationId, recipientUserId: userId },
        include: { recipient: { select: { role: true } } },
      }),
      this.db.pushSubscription.findMany({ where: { userId } }),
    ]);
    if (!notification || !subscriptions.length) return;
    const url =
      notification.targetKind === 'CHAT_CONVERSATION'
        ? `${chatPath(notification.recipient.role)}?conversation=${encodeURIComponent(notification.targetId)}`
        : '/';
    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      tag: `edugrade-${notification.id}`,
      data: { url, notificationId: notification.id },
    });
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webPush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            payload,
            { TTL: 86400, urgency: 'high' },
          );
        } catch (error) {
          const statusCode =
            typeof error === 'object' && error && 'statusCode' in error
              ? Number(error.statusCode)
              : 0;
          if (statusCode === 404 || statusCode === 410) {
            await this.db.pushSubscription.deleteMany({ where: { id: subscription.id } });
            return;
          }
          this.logger.warn({
            event: 'web_push.delivery_failed',
            notificationId,
            statusCode: statusCode || undefined,
          });
        }
      }),
    );
  }
}
