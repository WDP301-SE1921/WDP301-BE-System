import { AcademicStorageService } from '../../src/integrations/academic-storage.service';
import { AppError } from '../../src/common/errors/app.error';

describe('AcademicStorageService Unit Tests', () => {
  let service: AcademicStorageService;
  let mockObjectStorage: any;
  let mockRepo: any;

  beforeEach(() => {
    mockObjectStorage = {
      putObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      createSignedGetUrl: jest.fn().mockResolvedValue({ url: 'http://signed-url', expiresIn: 60 }),
    };

    mockRepo = {
      db: {
        fileAsset: {
          create: jest.fn(),
          findUniqueOrThrow: jest.fn(),
        },
        submissionFile: {
          count: jest.fn(),
        },
      },
    };

    service = new AcademicStorageService(mockObjectStorage as any, mockRepo as any);
  });

  const parentUser: any = { id: 'parent-1', role: 'PARENT' };
  const teacherUser: any = { id: 'teacher-1', role: 'TEACHER' };
  const strangerUser: any = { id: 'other-user', role: 'PARENT' };

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

  it('preview should sign attachment/non-inline for PDF', async () => {
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
        inline: false,
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

  it('upload should rollback and delete object if database record creation fails', async () => {
    const validPdf = Buffer.from('%PDF-1.4 sample content');
    const file: any = {
      originalname: 'homework.pdf',
      mimetype: 'application/pdf',
      size: validPdf.length,
      buffer: validPdf,
    };

    mockRepo.db.fileAsset.create.mockRejectedValue(new Error('DB failure'));

    await expect(service.upload(parentUser, file)).rejects.toThrow('DB failure');

    expect(mockObjectStorage.putObject).toHaveBeenCalledTimes(1);
    expect(mockObjectStorage.deleteObject).toHaveBeenCalledWith(
      expect.stringMatching(/^submissions\/parent-1\//),
    );
  });
});
