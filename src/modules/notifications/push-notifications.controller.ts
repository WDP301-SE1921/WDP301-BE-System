import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import {
  DeletePushSubscriptionDto,
  PushPublicKeyDto,
  PushSubscriptionResultDto,
  SavePushSubscriptionDto,
} from './push-notifications.dto';
import { PushNotificationsService } from './push-notifications.service';

@ApiTags('push notifications')
@ApiBearerAuth()
@Controller({ path: 'push', version: '1' })
export class PushNotificationsController {
  constructor(private readonly push: PushNotificationsService) {}

  @Get('public-key')
  @ApiOperation({ summary: 'Return the Web Push VAPID public key when push is configured' })
  settings(): PushPublicKeyDto {
    return this.push.settings();
  }

  @Post('subscriptions')
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: SavePushSubscriptionDto,
  ): Promise<PushSubscriptionResultDto> {
    return this.push.save(user, input);
  }

  @Delete('subscriptions')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: DeletePushSubscriptionDto,
  ): Promise<PushSubscriptionResultDto> {
    return this.push.remove(user.id, input.endpoint);
  }
}
