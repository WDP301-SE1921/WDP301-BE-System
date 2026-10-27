import { AppError } from '../../src/common/errors/app.error';
import {
  validateAcademicSubmissionFile,
  validateAvatarImageFile,
} from '../../src/integrations/file-validation';

describe('File Validation Unit Tests', () => {
  const validPdfHeader = Buffer.from('%PDF-1.4 test content');
  const validJpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const validPngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

  describe('validateAcademicSubmissionFile', () => {
    it('should accept valid PDF file within 10MB', () => {
      const file = {
        originalname: 'assignment.pdf',
        mimetype: 'application/pdf',
        size: validPdfHeader.length,
        buffer: validPdfHeader,
      } as Express.Multer.File;

      const res = validateAcademicSubmissionFile(file);
      expect(res.extension).toBe('.pdf');
      expect(res.mimeType).toBe('application/pdf');
    });

    it('should accept valid PNG and JPEG files within 10MB', () => {
      const pngFile = {
        originalname: 'answer.PNG',
        mimetype: 'image/png',
        size: validPngHeader.length,
        buffer: validPngHeader,
      } as Express.Multer.File;

      expect(validateAcademicSubmissionFile(pngFile).extension).toBe('.png');

      const jpegFile = {
        originalname: 'photo.jpg',
        mimetype: 'image/jpeg',
        size: validJpegHeader.length,
        buffer: validJpegHeader,
      } as Express.Multer.File;

      expect(validateAcademicSubmissionFile(jpegFile).extension).toBe('.jpg');
    });

    it('should reject empty or missing file', () => {
      expect(() => validateAcademicSubmissionFile(undefined)).toThrow(AppError);

      const emptyFile = {
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        size: 0,
        buffer: Buffer.alloc(0),
      } as Express.Multer.File;
      expect(() => validateAcademicSubmissionFile(emptyFile)).toThrow(AppError);
    });

    it('should reject file exceeding 10MB', () => {
      const largeFile = {
        originalname: 'large.pdf',
        mimetype: 'application/pdf',
        size: 10 * 1024 * 1024 + 1,
        buffer: validPdfHeader,
      } as Express.Multer.File;
      expect(() => validateAcademicSubmissionFile(largeFile)).toThrow(AppError);
    });

    it('should reject spoofed extension or incorrect magic signature', () => {
      // Named .pdf but containing plain text
      const fakePdf = {
        originalname: 'fake.pdf',
        mimetype: 'application/pdf',
        size: 20,
        buffer: Buffer.from('hello world not a pdf'),
      } as Express.Multer.File;
      expect(() => validateAcademicSubmissionFile(fakePdf)).toThrow(AppError);

      // Named .exe
      const exeFile = {
        originalname: 'virus.exe',
        mimetype: 'application/octet-stream',
        size: 20,
        buffer: Buffer.from('MZ...'),
      } as Express.Multer.File;
      expect(() => validateAcademicSubmissionFile(exeFile)).toThrow(AppError);
    });
  });

  describe('validateAvatarImageFile', () => {
    it('should accept valid PNG and JPEG files within 5MB', () => {
      const pngFile = {
        originalname: 'avatar.png',
        mimetype: 'image/png',
        size: validPngHeader.length,
        buffer: validPngHeader,
      } as Express.Multer.File;

      const res = validateAvatarImageFile(pngFile);
      expect(res.extension).toBe('.png');
      expect(res.mimeType).toBe('image/png');
    });

    it('should reject PDF for avatar', () => {
      const pdfFile = {
        originalname: 'avatar.pdf',
        mimetype: 'application/pdf',
        size: validPdfHeader.length,
        buffer: validPdfHeader,
      } as Express.Multer.File;

      expect(() => validateAvatarImageFile(pdfFile)).toThrow(AppError);
    });

    it('should reject avatar exceeding 5MB', () => {
      const largeAvatar = {
        originalname: 'avatar.jpg',
        mimetype: 'image/jpeg',
        size: 5 * 1024 * 1024 + 1,
        buffer: validJpegHeader,
      } as Express.Multer.File;

      expect(() => validateAvatarImageFile(largeAvatar)).toThrow(AppError);
    });
  });
});
