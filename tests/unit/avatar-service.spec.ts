import { HttpStatus } from '@nestjs/common';
import { AuthService } from '../../src/modules/auth/auth.service';
import { AppError } from '../../src/common/errors/app.error';

describe('AuthService Avatar Unit Tests', () => {
  let authService: AuthService;
  let mockDb: any;
  let mockObjectStorage: any;
  let mockUsersService: any;

  beforeEach(() => {
    mockDb = {
      user: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };
    mockObjectStorage = {
      putObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      createSignedGetUrl: jest.fn().mockResolvedValue({ url: 'http://signed-url', expiresIn: 900 }),
    };
    mockUsersService = {
      toSafeUser: jest.fn((u) => ({
        id: u.id,
        email: u.email,
        hasAvatar: Boolean(u.avatarStorageKey),
      })),
    };

    authService = new AuthService(
      {} as any,
      {} as any,
      mockDb as any,
      {} as any,
      mockUsersService as any,
      mockObjectStorage as any,
    );
  });

  const mockUser: any = {
    id: 'user-123',
    email: 'test@example.com',
    role: 'PARENT',
    status: 'ACTIVE',
    hasAvatar: false,
  };

  it('getAvatar should return null url when user has no avatar', async () => {
    mockDb.user.findUnique.mockResolvedValue({ avatarStorageKey: null });

    const result = await authService.getAvatar(mockUser);
    expect(result).toEqual({ url: null, expiresIn: null });
    expect(mockObjectStorage.createSignedGetUrl).not.toHaveBeenCalled();
  });

  it('getAvatar should return signed url when user has an avatar', async () => {
    mockDb.user.findUnique.mockResolvedValue({ avatarStorageKey: 'avatars/user-123/existing.png' });

    const result = await authService.getAvatar(mockUser);
    expect(result.url).toBe('http://signed-url');
    expect(result.expiresIn).toBe(900);
    expect(mockObjectStorage.createSignedGetUrl).toHaveBeenCalledWith(
      'avatars/user-123/existing.png',
      expect.objectContaining({ expiresInSeconds: 900, inline: true }),
    );
  });

  it('updateAvatar should succeed, upload object, conditionally update DB, and clean up old avatar', async () => {
    mockDb.user.findUniqueOrThrow.mockResolvedValue({ avatarStorageKey: 'avatars/user-123/old.png' });
    mockDb.user.updateMany.mockResolvedValue({ count: 1 });

    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const file: any = {
      originalname: 'new-avatar.png',
      mimetype: 'image/png',
      size: validPng.length,
      buffer: validPng,
    };

    const result = await authService.updateAvatar(mockUser, file);
    expect(result.url).toBe('http://signed-url');
    expect(result.expiresIn).toBe(900);

    expect(mockObjectStorage.putObject).toHaveBeenCalledTimes(1);
    expect(mockDb.user.updateMany).toHaveBeenCalledWith({
      where: { id: mockUser.id, avatarStorageKey: 'avatars/user-123/old.png' },
      data: expect.objectContaining({ avatarStorageKey: expect.stringMatching(/^avatars\/user-123\//) }),
    });
    // Old object deletion was triggered
    expect(mockObjectStorage.deleteObject).toHaveBeenCalledWith('avatars/user-123/old.png');
  });

  it('updateAvatar should throw CONFLICT 409 and clean up new object if concurrent update modified avatar', async () => {
    mockDb.user.findUniqueOrThrow.mockResolvedValue({ avatarStorageKey: 'avatars/user-123/old.png' });
    // Simulate concurrent update: updateMany matched 0 rows because avatarStorageKey changed
    mockDb.user.updateMany.mockResolvedValue({ count: 0 });

    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const file: any = {
      originalname: 'new-avatar.png',
      mimetype: 'image/png',
      size: validPng.length,
      buffer: validPng,
    };

    await expect(authService.updateAvatar(mockUser, file)).rejects.toThrow(
      new AppError('AVATAR_CONFLICT', 'Avatar was modified concurrently by another request', HttpStatus.CONFLICT),
    );

    // Verify cleanup of newly uploaded object
    expect(mockObjectStorage.deleteObject).toHaveBeenCalledWith(
      expect.stringMatching(/^avatars\/user-123\//),
    );
  });

  it('deleteAvatar should clear DB and delete object from storage', async () => {
    mockDb.user.findUnique.mockResolvedValue({ avatarStorageKey: 'avatars/user-123/current.jpg' });
    mockDb.user.update.mockResolvedValue({});

    const result = await authService.deleteAvatar(mockUser);
    expect(result).toEqual({ deleted: true });
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: mockUser.id },
      data: { avatarStorageKey: null },
    });
    expect(mockObjectStorage.deleteObject).toHaveBeenCalledWith('avatars/user-123/current.jpg');
  });

  it('deleteAvatar should succeed idempotently if user has no avatar', async () => {
    mockDb.user.findUnique.mockResolvedValue({ avatarStorageKey: null });

    const result = await authService.deleteAvatar(mockUser);
    expect(result).toEqual({ deleted: true });
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(mockObjectStorage.deleteObject).not.toHaveBeenCalled();
  });
});
