import {
  ChatService,
  canUseChat,
  directConversationKey,
} from '../../src/modules/chat/chat.service';
import { validateChatAttachment } from '../../src/integrations/file-validation';

function upload(originalname: string, mimetype: string, buffer: Buffer): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    buffer,
    destination: '',
    filename: '',
    path: '',
    stream: null as never,
  };
}

describe('Chat access rules', () => {
  it.each(['MANAGER', 'STAFF', 'TEACHER', 'CURRICULUM_DESIGNER'] as const)(
    'allows %s to use internal chat',
    (role) => expect(canUseChat(role)).toBe(true),
  );

  it('does not allow parent accounts to use internal chat', () => {
    expect(canUseChat('PARENT')).toBe(false);
  });

  it('creates the same direct-conversation key regardless of participant order', () => {
    expect(directConversationKey('user-b', 'user-a')).toBe('user-a:user-b');
    expect(directConversationKey('user-a', 'user-b')).toBe('user-a:user-b');
  });
});

describe('Chat attachment validation', () => {
  it('accepts matching PNG content and sanitizes the filename', () => {
    const file = upload(
      '../ảnh\u0000 lớp.png',
      'image/png',
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
    );
    expect(validateChatAttachment(file)).toMatchObject({
      extension: '.png',
      mimeType: 'image/png',
      filename: '.._ảnh_ lớp.png',
      isImage: true,
    });
  });

  it('accepts common text files as downloadable attachments', () => {
    expect(
      validateChatAttachment(upload('notes.txt', 'text/plain', Buffer.from('hello'))),
    ).toMatchObject({
      extension: '.txt',
      isImage: false,
    });
  });

  it('rejects executable files', () => {
    expect(() =>
      validateChatAttachment(upload('payload.exe', 'application/octet-stream', Buffer.from('MZ'))),
    ).toThrow('Only images, PDF, Office, CSV, TXT and ZIP files are accepted');
  });
});

describe('Chat message revoke', () => {
  const sender = {
    id: 'sender',
    displayName: 'Sender',
    email: 'sender@example.com',
    role: 'MANAGER',
  };
  const user = { id: 'sender', role: 'MANAGER' };

  it('replaces the sender message with a tombstone and deletes its attachment', async () => {
    const tx = {
      chatParticipant: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'sender' }),
        findMany: jest.fn().mockResolvedValue([{ userId: 'recipient' }]),
      },
      chatMessage: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'message',
          conversationId: 'conversation',
          senderId: 'sender',
          body: 'hello',
          attachmentStorageKey: 'chat/file.png',
          attachmentName: 'file.png',
          attachmentMimeType: 'image/png',
          attachmentSize: 10,
          createdAt: new Date('2026-11-06T07:59:00.000Z'),
          deletedAt: null,
          sender,
        }),
        update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          id: 'message',
          conversationId: 'conversation',
          senderId: 'sender',
          createdAt: new Date('2026-11-06T07:59:00.000Z'),
          sender,
          ...data,
        })),
      },
      chatConversation: { update: jest.fn().mockResolvedValue({}) },
      notificationDispatch: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const db = {
      $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const objectStorage = {
      deleteObject: jest.fn().mockResolvedValue(undefined),
      createSignedGetUrl: jest.fn(),
    };
    const service = new ChatService(db as never, {} as never, objectStorage as never);

    const result = await service.revoke(user as never, 'conversation', 'message');

    expect(result).toMatchObject({ id: 'message', body: '', sender: { id: 'sender' } });
    expect(result.deletedAt).toBeInstanceOf(Date);
    expect(tx.chatMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: '',
          attachmentStorageKey: null,
          attachmentName: null,
          attachmentMimeType: null,
          attachmentSize: null,
          deletedAt: expect.any(Date) as unknown,
        }) as unknown,
      }),
    );
    expect(tx.notificationDispatch.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          recipientUserId: 'recipient',
          event: 'chat.message.deleted',
          payload: expect.objectContaining({
            conversationId: 'conversation',
            messageId: 'message',
          }) as unknown,
        }),
      ],
    });
    expect(objectStorage.deleteObject).toHaveBeenCalledWith('chat/file.png');
    expect(objectStorage.createSignedGetUrl).not.toHaveBeenCalled();
  });

  it('does not let another participant revoke the sender message', async () => {
    const tx = {
      chatParticipant: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'recipient' }),
      },
      chatMessage: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'message',
          conversationId: 'conversation',
          senderId: 'sender',
          deletedAt: null,
          sender,
        }),
        update: jest.fn(),
      },
    };
    const db = {
      $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const objectStorage = { deleteObject: jest.fn() };
    const service = new ChatService(db as never, {} as never, objectStorage as never);

    await expect(
      service.revoke({ id: 'recipient', role: 'STAFF' } as never, 'conversation', 'message'),
    ).rejects.toMatchObject({ code: 'CHAT_MESSAGE_DELETE_FORBIDDEN' });
    expect(tx.chatMessage.update).not.toHaveBeenCalled();
    expect(objectStorage.deleteObject).not.toHaveBeenCalled();
  });
});
