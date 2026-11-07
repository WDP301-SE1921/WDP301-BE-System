import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ChatUserQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ default: 50 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}

export class CreateConversationDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(191) participantUserId!: string;
}

export class MessageQueryDto {
  @ApiPropertyOptional({ description: 'Load messages older than this message id.' })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  cursor?: string;

  @ApiPropertyOptional({ default: 50 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}

export class SendMessageDto {
  @ApiPropertyOptional({ maxLength: 2000, description: 'Optional when a file is attached.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;
}

export class ChatUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: ['MANAGER', 'STAFF', 'TEACHER', 'CURRICULUM_DESIGNER'] }) role!: string;
}

export class ChatAttachmentDto {
  @ApiProperty() name!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty() size!: number;
  @ApiProperty() url!: string;
  @ApiProperty() expiresIn!: number;
  @ApiProperty() isImage!: boolean;
}

export class ChatMessageDto {
  @ApiProperty() id!: string;
  @ApiProperty() conversationId!: string;
  @ApiProperty() body!: string;
  @ApiPropertyOptional({ type: ChatAttachmentDto }) attachment?: ChatAttachmentDto;
  @ApiProperty() createdAt!: Date;
  @ApiPropertyOptional({ nullable: true }) deletedAt?: Date;
  @ApiProperty({ type: ChatUserDto }) sender!: ChatUserDto;
}

export class ChatConversationDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: ChatUserDto }) participant!: ChatUserDto;
  @ApiPropertyOptional({ type: ChatMessageDto }) lastMessage?: ChatMessageDto;
  @ApiProperty() unreadCount!: number;
  @ApiProperty() updatedAt!: Date;
}

export class ChatMessagePageDto {
  @ApiProperty({ type: [ChatMessageDto] }) items!: ChatMessageDto[];
  @ApiPropertyOptional({ nullable: true }) nextCursor!: string | null;
}

export class ChatUnreadDto {
  @ApiProperty() unreadCount!: number;
}

export class ChatReadDto extends ChatUnreadDto {
  @ApiProperty() readAt!: Date;
}
