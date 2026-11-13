import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import type { ObjectStorageService } from '../../src/integrations/object-storage.service';
import type { AcademicRepository } from '../../src/modules/academic/academic.repository';
import { AcademicStorageService } from '../../src/integrations/academic-storage.service';
import { AppError } from '../../src/common/errors/app.error';

describe('AcademicStorageService Unit Tests', () => {
  let service: AcademicStorageService;
  let mockObjectStorage: {
    putObject: jest.Mock;
    deleteObject: jest.Mock;
    createSignedGetUrl: jest.Mock;
    readObject: jest.Mock;
  };
  let mockRepo: {
    db: {
      fileAsset: { create: jest.Mock; findUniqueOrThrow: jest.Mock };
      assignmentFile: { count: jest.Mock };
      submissionFile: { count: jest.Mock };
    };
  };

  beforeEach(() => {
    mockObjectStorage = {
      putObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      createSignedGetUrl: jest.fn().mockResolvedValue({ url: 'http://signed-url', expiresIn: 60 }),
      readObject: jest.fn().mockResolvedValue(Buffer.from('private-image-bytes')),
    };

    mockRepo = {
      db: {
        fileAsset: {
          create: jest.fn(),
          findUniqueOrThrow: jest.fn(),
        },
        assignmentFile: { count: jest.fn().mockResolvedValue(0) },
        submissionFile: {
          count: jest.fn(),
        },
      },
    };

    service = new AcademicStorageService(
      mockObjectStorage as unknown as ObjectStorageService,
      mockRepo as unknown as AcademicRepository,
    );
  });

  const parentUser = { id: 'parent-1', role: 'PARENT' } as AuthenticatedUser;
  const teacherUser = { id: 'teacher-1', role: 'TEACHER' } as AuthenticatedUser;
  const strangerUser = { id: 'other-user', role: 'PARENT' } as AuthenticatedUser;

  it('streams an owned image through the authenticated API instead of a public HTTP URL', async () => {
    mockRepo.db.fileAsset.findUniqueOrThrow.mockResolvedValue({
      id: 'file-1',
      ownerId: parentUser.id,
      storageKey: 'private/image.png',
      mimeType: 'image/png',
    });
    await expect(service.content(parentUser, 'file-1')).resolves.toEqual({
      buffer: Buffer.from('private-image-bytes'),
      mimeType: 'image/png',
    });
    expect(mockObjectStorage.readObject).toHaveBeenCalledWith('private/image.png');
    expect(mockObjectStorage.createSignedGetUrl).not.toHaveBeenCalled();
  });

  it('never reads file bytes for another parent', async () => {
    mockRepo.db.fileAsset.findUniqueOrThrow.mockResolvedValue({
      id: 'file-1',
      ownerId: parentUser.id,
      storageKey: 'private/image.png',
      mimeType: 'image/png',
    });
    await expect(service.content(strangerUser, 'file-1')).rejects.toThrow(AppError);
    expect(mockObjectStorage.readObject).not.toHaveBeenCalled();
  });

  it('streams a submitted image only to its assigned teacher', async () => {
    mockRepo.db.fileAsset.findUniqueOrThrow.mockResolvedValue({
      id: 'file-1',
      ownerId: parentUser.id,
      storageKey: 'private/image.png',
      mimeType: 'image/png',
    });
    mockRepo.db.submissionFile.count.mockResolvedValue(1);
    await expect(service.content(teacherUser, 'file-1')).resolves.toMatchObject({
      mimeType: 'image/png',
    });
    expect(mockObjectStorage.readObject).toHaveBeenCalledTimes(1);
  });

  it('preview should sign inline URL with 300 seconds TTL for image file', async () => {
    mockRepo.db.fileAsset.findUniqueOrThrow.mockResolvedValue({
      id: 'file-1',
      ownerId: 'parent-1',
      storageKey: 'submissions/parent-1/abc.png',
      mimeType: 'image/png',
    });
    mockObjectStorage.createSignedGetUrl.mockResolvedValue({
      url: 'http://preview-url',
      expiresIn: 300,
    });

    const res = await service.preview(parentUser, 'file-1');
    expect(res.url).toBe('http://preview-url');
    expect(res.expiresIn).toBe(300);
    expect(mockObjectStorage.createSignedGetUrl).toHaveBeenCalledWith(
      'submissions/parent-1/abc.png',
      {
        expiresInSeconds: 300,
        inline: true,
        contentType: 'image/png',
      },
    );
  });

  it('preview should sign inline for PDF', async () => {
    mockRepo.db.fileAsset.findUniqueOrThrow.mockResolvedValue({
      id: 'file-2',
      ownerId: 'parent-1',
      storageKey: 'submissions/parent-1/doc.pdf',
      mimeType: 'application/pdf',
    });
    mockObjectStorage.createSignedGetUrl.mockResolvedValue({
      url: 'http://pdf-url',
      expiresIn: 300,
    });

    await service.preview(parentUser, 'file-2');
    expect(mockObjectStorage.createSignedGetUrl).toHaveBeenCalledWith(
      'submissions/parent-1/doc.pdf',
      {
        expiresInSeconds: 300,
        inline: true,
        contentType: 'application/pdf',
      },
    );
  });

  it('preview should forbid user who is neither owner nor assigned teacher', async () => {
    mockRepo.db.fileAsset.findUniqueOrThrow.mockResolvedValue({
      id: 'file-1',
      ownerId: 'parent-1',
      storageKey: 'submissions/parent-1/abc.png',
      mimeType: 'image/png',
    });

    await expect(service.preview(strangerUser, 'file-1')).rejects.toThrow(AppError);
  });

  it('preview should allow assigned teacher', async () => {
    mockRepo.db.fileAsset.findUniqueOrThrow.mockResolvedValue({
      id: 'file-1',
      ownerId: 'parent-1',
      storageKey: 'submissions/parent-1/abc.png',
      mimeType: 'image/png',
    });
    mockRepo.db.submissionFile.count.mockResolvedValue(1);
    mockObjectStorage.createSignedGetUrl.mockResolvedValue({
      url: 'http://teacher-preview-url',
      expiresIn: 300,
    });

    const res = await service.preview(teacherUser, 'file-1');
    expect(res.url).toBe('http://teacher-preview-url');
  });

  it('allows a parent recipient only through a published, student-visible assignment file', async () => {
    mockRepo.db.fileAsset.findUniqueOrThrow.mockResolvedValue({
      id: 'file-1',
      ownerId: 'teacher-1',
      storageKey: 'assignment/exam.pdf',
      mimeType: 'application/pdf',
    });
    mockRepo.db.assignmentFile.count.mockResolvedValue(1);
    await service.preview(parentUser, 'file-1');
    expect(mockRepo.db.assignmentFile.count).toHaveBeenCalledWith({
      where: {
        fileId: 'file-1',
        teacherOnly: false,
        assignment: {
          status: { not: 'DRAFT' },
          recipients: {
            some: {
              enrollment: {
                status: { not: 'PENDING_LINK' },
                studentProfile: { parentProfile: { userId: 'parent-1' } },
              },
            },
          },
        },
      },
    });
  });

  it('does not sign a teacher-only file for a parent without recipient access', async () => {
    mockRepo.db.fileAsset.findUniqueOrThrow.mockResolvedValue({
      id: 'answers',
      ownerId: 'teacher-1',
      storageKey: 'private/answers.pdf',
      mimeType: 'application/pdf',
    });
    await expect(service.preview(parentUser, 'answers')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mockObjectStorage.createSignedGetUrl).not.toHaveBeenCalled();
  });

  it('upload should rollback and delete object if database record creation fails', async () => {
    const validPdf = Buffer.from('%PDF-1.4 sample content');
    const file = {
      originalname: 'homework.pdf',
      mimetype: 'application/pdf',
      size: validPdf.length,
      buffer: validPdf,
    } as Express.Multer.File;

    mockRepo.db.fileAsset.create.mockRejectedValue(new Error('DB failure'));

    await expect(service.upload(parentUser, file)).rejects.toThrow('DB failure');

    expect(mockObjectStorage.putObject).toHaveBeenCalledTimes(1);
    expect(mockObjectStorage.deleteObject).toHaveBeenCalledWith(
      expect.stringMatching(/^submissions\/parent-1\//),
    );
  });
});
