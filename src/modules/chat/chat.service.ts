import { HttpStatus, Injectable } from '@nestjs/common';
import type { ChatMessage, Prisma, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors/app.error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { DatabaseService } from '../../database/orm/database.service';
import { validateChatAttachment } from '../../integrations/file-validation';
import { ObjectStorageService } from '../../integrations/object-storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  ChatConversationDto,
  ChatMessageDto,
  ChatMessagePageDto,
  ChatReadDto,
  ChatUnreadDto,
  ChatUserDto,
  ChatUserQueryDto,
  MessageQueryDto,
} from './chat.dto';

export const CHAT_ROLES = [
  'MANAGER',
  'STAFF',
  'TEACHER',
  'CURRICULUM_DESIGNER',
] as const satisfies readonly UserRole[];

const chatUserSelect = {
  id: true,
  displayName: true,
  email: true,
  role: true,
} satisfies Prisma.UserSelect;

type ChatUserRow = Prisma.UserGetPayload<{ select: typeof chatUserSelect }>;
type MessageRow = ChatMessage & { sender: ChatUserRow };

export function canUseChat(role: UserRole): boolean {
  return (CHAT_ROLES as readonly UserRole[]).includes(role);
}

export function directConversationKey(firstUserId: string, secondUserId: string): string {
  return [firstUserId, secondUserId].sort().join(':');
}

function userItem(user: ChatUserRow): ChatUserDto {
  return {
    id: user.id,
    name: user.displayName?.trim() || user.email,
    email: user.email,
    role: user.role,
  };
}

@Injectable()
export class ChatService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  async users(user: AuthenticatedUser, query: ChatUserQueryDto): Promise<ChatUserDto[]> {
    this.requireChatRole(user);
    const search = query.search?.trim();
    const rows = await this.db.user.findMany({
      where: {
        id: { not: user.id },
        role: { in: [...CHAT_ROLES] },
        status: 'ACTIVE',
        ...(search
          ? {
              OR: [{ displayName: { contains: search } }, { email: { contains: search } }],
            }
          : {}),
      },
      select: chatUserSelect,
      orderBy: [{ displayName: 'asc' }, { email: 'asc' }],
      take: query.limit,
    });
    return rows.map(userItem);
  }

  async conversations(user: AuthenticatedUser): Promise<ChatConversationDto[]> {
    this.requireChatRole(user);
    const rows = await this.db.chatParticipant.findMany({
      where: { userId: user.id },
      include: {
        conversation: {
          include: {
            participants: {
              where: { userId: { not: user.id } },
              include: { user: { select: chatUserSelect } },
            },
            messages: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
              include: { sender: { select: chatUserSelect } },
            },
          },
        },
      },
      orderBy: { conversation: { updatedAt: 'desc' } },
    });
    return Promise.all(
      rows.flatMap((row) => {
        const participant = row.conversation.participants[0]?.user;
        if (!participant || !canUseChat(participant.role)) return [];
        return [
          this.db.chatMessage
            .count({
              where: {
                conversationId: row.conversationId,
                senderId: { not: user.id },
                createdAt: { gt: row.lastReadAt },
                deletedAt: null,
              },
            })
            .then(async (unreadCount) => ({
              id: row.conversationId,
              participant: userItem(participant),
              ...(row.conversation.messages[0]
                ? { lastMessage: await this.messageItem(row.conversation.messages[0]) }
                : {}),
              unreadCount,
              updatedAt: row.conversation.updatedAt,
            })),
        ];
      }),
    );
  }

  async createConversation(
    user: AuthenticatedUser,
    participantUserId: string,
  ): Promise<ChatConversationDto> {
    this.requireChatRole(user);
    if (participantUserId === user.id) {
      throw new AppError('CHAT_SELF_NOT_ALLOWED', 'Cannot start a chat with yourself');
    }
    const participant = await this.db.user.findFirst({
      where: { id: participantUserId, role: { in: [...CHAT_ROLES] }, status: 'ACTIVE' },
      select: chatUserSelect,
    });
    if (!participant) {
      throw new AppError('CHAT_USER_NOT_FOUND', 'Chat user not found', HttpStatus.NOT_FOUND);
    }
    const directKey = directConversationKey(user.id, participantUserId);
    const conversation = await this.db.chatConversation.upsert({
      where: { directKey },
      create: {
        directKey,
        participants: {
          create: [{ userId: user.id }, { userId: participantUserId }],
        },
      },
      update: {},
    });
    return {
      id: conversation.id,
      participant: userItem(participant),
      unreadCount: 0,
      updatedAt: conversation.updatedAt,
    };
  }

  async messages(
    user: AuthenticatedUser,
    conversationId: string,
    query: MessageQueryDto,
  ): Promise<ChatMessagePageDto> {
    this.requireChatRole(user);
    await this.requireParticipant(user.id, conversationId);
    if (query.cursor) {
      const cursor = await this.db.chatMessage.findFirst({
        where: { id: query.cursor, conversationId },
        select: { id: true },
      });
      if (!cursor) {
        throw new AppError(
          'CHAT_CURSOR_NOT_FOUND',
          'Message cursor not found',
          HttpStatus.NOT_FOUND,
        );
      }
    }
    const rows = await this.db.chatMessage.findMany({
      where: { conversationId },
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { sender: { select: chatUserSelect } },
    });
    const nextCursor = rows.length === query.limit ? rows.at(-1)!.id : null;
    return {
      items: await Promise.all(rows.reverse().map((message) => this.messageItem(message))),
      nextCursor,
    };
  }

  async send(
    user: AuthenticatedUser,
    conversationId: string,
    rawBody?: string,
    file?: Express.Multer.File,
  ): Promise<ChatMessageDto> {
    this.requireChatRole(user);
    const body = rawBody?.trim() ?? '';
    if (!body && !file)
      throw new AppError('CHAT_MESSAGE_EMPTY', 'Message text or an attachment is required');
    if (body.length > 2000)
      throw new AppError('CHAT_MESSAGE_TOO_LONG', 'Message cannot exceed 2000 characters');

    await this.requireParticipant(user.id, conversationId);
    const availableRecipient = await this.db.chatParticipant.count({
      where: {
        conversationId,
        userId: { not: user.id },
        user: { role: { in: [...CHAT_ROLES] }, status: 'ACTIVE' },
      },
    });
    if (!availableRecipient) {
      throw new AppError(
        'CHAT_RECIPIENT_UNAVAILABLE',
        'Chat recipient is unavailable',
        HttpStatus.CONFLICT,
      );
    }

    let attachment:
      | {
          storageKey: string;
          name: string;
          mimeType: string;
          size: number;
          isImage: boolean;
        }
      | undefined;
    if (file) {
      const validated = validateChatAttachment(file);
      attachment = {
        storageKey: `chat/${conversationId}/${randomUUID()}${validated.extension}`,
        name: validated.filename,
        mimeType: validated.mimeType,
        size: file.size,
        isImage: validated.isImage,
      };
      await this.objectStorage.putObject({
        key: attachment.storageKey,
        buffer: file.buffer,
        mimeType: attachment.mimeType,
      });
    }

    try {
      const message = await this.db.$transaction(async (tx) => {
        await this.requireParticipant(user.id, conversationId, tx);
        const recipients = await tx.chatParticipant.findMany({
          where: {
            conversationId,
            userId: { not: user.id },
            user: { role: { in: [...CHAT_ROLES] }, status: 'ACTIVE' },
          },
          select: { userId: true },
        });
        if (!recipients.length) {
          throw new AppError(
            'CHAT_RECIPIENT_UNAVAILABLE',
            'Chat recipient is unavailable',
            HttpStatus.CONFLICT,
          );
        }
        const message = await tx.chatMessage.create({
          data: {
            conversationId,
            senderId: user.id,
            body,
            ...(attachment
              ? {
                  attachmentStorageKey: attachment.storageKey,
                  attachmentName: attachment.name,
                  attachmentMimeType: attachment.mimeType,
                  attachmentSize: attachment.size,
                }
              : {}),
          },
          include: { sender: { select: chatUserSelect } },
        });
        await Promise.all([
          tx.chatConversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
          }),
          tx.chatParticipant.update({
            where: { conversationId_userId: { conversationId, userId: user.id } },
            data: { lastReadAt: message.createdAt },
          }),
        ]);
        await this.notifications.record(tx, {
          eventKey: `chat:${message.id}`,
          type: 'CHAT_MESSAGE',
          actorId: user.id,
          title: `${message.sender.displayName?.trim() || message.sender.email} đã gửi tin nhắn`,
          body: body
            ? body.length > 160
              ? `${body.slice(0, 157)}…`
              : body
            : attachment?.isImage
              ? 'Đã gửi một hình ảnh'
              : `Đã gửi tệp: ${attachment?.name ?? 'Đính kèm'}`,
          targetKind: 'CHAT_CONVERSATION',
          targetId: conversationId,
          recipients: recipients.map((recipient) => ({ userId: recipient.userId })),
        });
        await tx.notificationDispatch.createMany({
          data: recipients.map((recipient) => ({
            recipientUserId: recipient.userId,
            event: 'chat.message.created',
            payload: { conversationId, messageId: message.id },
          })),
        });
        return message;
      });
      return this.messageItem(message);
    } catch (error) {
      if (attachment) await this.objectStorage.deleteObject(attachment.storageKey);
      throw error;
    }
  }

  async read(user: AuthenticatedUser, conversationId: string): Promise<ChatReadDto> {
    this.requireChatRole(user);
    const readAt = new Date();
    await this.db.$transaction(async (tx) => {
      await this.requireParticipant(user.id, conversationId, tx);
      await tx.chatParticipant.update({
        where: { conversationId_userId: { conversationId, userId: user.id } },
        data: { lastReadAt: readAt },
      });
      const recipients = await tx.chatParticipant.findMany({
        where: { conversationId, userId: { not: user.id } },
        select: { userId: true },
      });
      await tx.notificationDispatch.createMany({
        data: recipients.map((recipient) => ({
          recipientUserId: recipient.userId,
          event: 'chat.conversation.read',
          payload: { conversationId, userId: user.id, readAt: readAt.toISOString() },
        })),
      });
    });
    return { readAt, ...(await this.unread(user)) };
  }

  async revoke(
    user: AuthenticatedUser,
    conversationId: string,
    messageId: string,
  ): Promise<ChatMessageDto> {
    this.requireChatRole(user);
    let attachmentStorageKey: string | null = null;
    const message = await this.db.$transaction(async (tx) => {
      await this.requireParticipant(user.id, conversationId, tx);
      const existing = await tx.chatMessage.findFirst({
        where: { id: messageId, conversationId },
        include: { sender: { select: chatUserSelect } },
      });
      if (!existing) {
        throw new AppError(
          'CHAT_MESSAGE_NOT_FOUND',
          'Chat message not found',
          HttpStatus.NOT_FOUND,
        );
      }
      if (existing.senderId !== user.id) {
        throw new AppError(
          'CHAT_MESSAGE_DELETE_FORBIDDEN',
          'Only the sender can revoke this message',
          HttpStatus.FORBIDDEN,
        );
      }
      if (existing.deletedAt) return existing;

      attachmentStorageKey = existing.attachmentStorageKey;
      const deletedAt = new Date();
      const revoked = await tx.chatMessage.update({
        where: { id: messageId },
        data: {
          body: '',
          attachmentStorageKey: null,
          attachmentName: null,
          attachmentMimeType: null,
          attachmentSize: null,
          deletedAt,
        },
        include: { sender: { select: chatUserSelect } },
      });
      const recipients = await tx.chatParticipant.findMany({
        where: { conversationId, userId: { not: user.id } },
        select: { userId: true },
      });
      await Promise.all([
        tx.chatConversation.update({
          where: { id: conversationId },
          data: { updatedAt: deletedAt },
        }),
        tx.notificationDispatch.createMany({
          data: recipients.map((recipient) => ({
            recipientUserId: recipient.userId,
            event: 'chat.message.deleted',
            payload: { conversationId, messageId, deletedAt: deletedAt.toISOString() },
          })),
        }),
      ]);
      return revoked;
    });
    if (attachmentStorageKey) await this.objectStorage.deleteObject(attachmentStorageKey);
    return this.messageItem(message);
  }

  async unread(user: AuthenticatedUser): Promise<ChatUnreadDto> {
    this.requireChatRole(user);
    const participants = await this.db.chatParticipant.findMany({
      where: { userId: user.id },
      select: { conversationId: true, lastReadAt: true },
    });
    const counts = await Promise.all(
      participants.map((participant) =>
        this.db.chatMessage.count({
          where: {
            conversationId: participant.conversationId,
            senderId: { not: user.id },
            createdAt: { gt: participant.lastReadAt },
            deletedAt: null,
          },
        }),
      ),
    );
    return { unreadCount: counts.reduce((sum, count) => sum + count, 0) };
  }

  private requireChatRole(user: AuthenticatedUser): void {
    if (!canUseChat(user.role)) {
      throw new AppError('CHAT_FORBIDDEN', 'Role is not allowed to use chat', HttpStatus.FORBIDDEN);
    }
  }

  private async messageItem(message: MessageRow): Promise<ChatMessageDto> {
    const base: ChatMessageDto = {
      id: message.id,
      conversationId: message.conversationId,
      body: message.body,
      createdAt: message.createdAt,
      ...(message.deletedAt ? { deletedAt: message.deletedAt } : {}),
      sender: userItem(message.sender),
    };
    if (message.deletedAt) return base;
    if (
      !message.attachmentStorageKey ||
      !message.attachmentName ||
      !message.attachmentMimeType ||
      message.attachmentSize === null
    )
      return base;
    const signed = await this.objectStorage.createSignedGetUrl(message.attachmentStorageKey, {
      expiresInSeconds: 3600,
      inline: message.attachmentMimeType.startsWith('image/'),
      contentType: message.attachmentMimeType,
      filename: message.attachmentName,
    });
    return {
      ...base,
      attachment: {
        name: message.attachmentName,
        mimeType: message.attachmentMimeType,
        size: message.attachmentSize,
        isImage: message.attachmentMimeType.startsWith('image/'),
        ...signed,
      },
    };
  }

  private async requireParticipant(
    userId: string,
    conversationId: string,
    tx: Prisma.TransactionClient = this.db,
  ): Promise<void> {
    const participant = await tx.chatParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { userId: true },
    });
    if (!participant) {
      throw new AppError(
        'CHAT_CONVERSATION_NOT_FOUND',
        'Chat conversation not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
