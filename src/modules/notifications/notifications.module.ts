import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { NotificationEventsService } from './notification-events.service';
import { NotificationRecipientsService } from './notification-recipients.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsWorker } from './notifications.worker';
import { PushNotificationsController } from './push-notifications.controller';
import { PushNotificationsService } from './push-notifications.service';
@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, PushNotificationsController],
  providers: [
    NotificationsRepository,
    NotificationsService,
    NotificationEventsService,
    NotificationRecipientsService,
    NotificationsGateway,
    NotificationsWorker,
    PushNotificationsService,
  ],
  exports: [NotificationEventsService, NotificationsService],
})
export class NotificationsModule {}
