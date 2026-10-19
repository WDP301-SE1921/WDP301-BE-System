import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { NotificationEventsService } from './notification-events.service';
import { NotificationRecipientsService } from './notification-recipients.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsWorker } from './notifications.worker';
@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    NotificationsService,
    NotificationEventsService,
    NotificationRecipientsService,
    NotificationsGateway,
    NotificationsWorker,
  ],
  exports: [NotificationEventsService, NotificationsService],
})
export class NotificationsModule {}
