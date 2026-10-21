import type { Type } from '@nestjs/common';
import { Controller, HttpCode, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import {
  NotificationItemDto,
  NotificationPageDto,
  NotificationQueryDto,
  ReadAllDto,
  UnreadCountDto,
} from './notifications.dto';
const envelope = (model: Type<unknown>): object => ({
  type: 'object',
  properties: { success: { type: 'boolean' }, data: { $ref: getSchemaPath(model) } },
});
@ApiTags('notifications')
@ApiBearerAuth()
@ApiExtraModels(NotificationItemDto, NotificationPageDto, ReadAllDto, UnreadCountDto)
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(
    private readonly repo: NotificationsRepository,
    private readonly service: NotificationsService,
  ) {}
  @Get()
  @ApiOkResponse({ schema: envelope(NotificationPageDto) })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: NotificationQueryDto,
  ): Promise<NotificationPageDto> {
    return this.repo.list(user.id, query);
  }
  @Get('unread-count')
  @ApiOkResponse({ schema: envelope(UnreadCountDto) })
  async count(@CurrentUser() user: AuthenticatedUser): Promise<UnreadCountDto> {
    return { unreadCount: await this.repo.unread(user.id) };
  }
  @Patch(':id/read')
  @ApiOkResponse({ schema: envelope(NotificationItemDto) })
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<NotificationItemDto> {
    return this.service.read(user.id, id);
  }
  @HttpCode(200)
  @Post('read-all')
  @ApiOkResponse({ schema: envelope(ReadAllDto) })
  readAll(@CurrentUser() user: AuthenticatedUser): Promise<ReadAllDto> {
    return this.service.readAll(user.id);
  }
}
