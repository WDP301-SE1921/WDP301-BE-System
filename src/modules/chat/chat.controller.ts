import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import {
  ChatConversationDto,
  ChatMessageDto,
  ChatMessagePageDto,
  ChatReadDto,
  ChatUnreadDto,
  ChatUserDto,
  ChatUserQueryDto,
  CreateConversationDto,
  MessageQueryDto,
  SendMessageDto,
} from './chat.dto';
import { ChatService } from './chat.service';

@ApiTags('chat')
@ApiBearerAuth()
@Controller({ path: 'chat', version: '1' })
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('users')
  @ApiOperation({ summary: 'List active management users available for direct chat' })
  users(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ChatUserQueryDto,
  ): Promise<ChatUserDto[]> {
    return this.chat.users(user, query);
  }

  @Get('conversations')
  conversations(@CurrentUser() user: AuthenticatedUser): Promise<ChatConversationDto[]> {
    return this.chat.conversations(user);
  }

  @Post('conversations')
  createConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateConversationDto,
  ): Promise<ChatConversationDto> {
    return this.chat.createConversation(user, input.participantUserId);
  }

  @Get('conversations/:id/messages')
  messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: MessageQueryDto,
  ): Promise<ChatMessagePageDto> {
    return this.chat.messages(user, id, query);
  }

  @Post('conversations/:id/messages')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() input: SendMessageDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<ChatMessageDto> {
    return this.chat.send(user, id, input.body, file);
  }

  @Delete('conversations/:id/messages/:messageId')
  @ApiOperation({ summary: 'Revoke one of your own messages for every participant' })
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ): Promise<ChatMessageDto> {
    return this.chat.revoke(user, id, messageId);
  }

  @HttpCode(200)
  @Post('conversations/:id/read')
  read(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<ChatReadDto> {
    return this.chat.read(user, id);
  }

  @Get('unread-count')
  unread(@CurrentUser() user: AuthenticatedUser): Promise<ChatUnreadDto> {
    return this.chat.unread(user);
  }
}
