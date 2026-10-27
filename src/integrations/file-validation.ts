import { extname } from 'node:path';
import { assertRule } from '../modules/academic/academic-access.service';

export interface FileValidationResult {
  extension: string;
  mimeType: string;
}

/**
 * Validates file buffer, size, MIME type and magic number signatures.
 */
export function validateAcademicSubmissionFile(
  file?: Express.Multer.File,
  maxSizeBytes = 10 * 1024 * 1024,
): FileValidationResult {
  assertRule(
    Boolean(file && file.size > 0 && file.size <= maxSizeBytes),
    'INVALID_FILE_SIZE',
    `A file up to ${Math.round(maxSizeBytes / (1024 * 1024))}MB is required`,
  );

  const nonNullFile = file!;
  const extension = extname(nonNullFile.originalname).toLowerCase();
  const buffer = nonNullFile.buffer;

  const isPdf =
    extension === '.pdf' &&
    nonNullFile.mimetype === 'application/pdf' &&
    buffer.length >= 5 &&
    buffer.subarray(0, 5).toString() === '%PDF-';

  const isJpeg =
    ['.jpg', '.jpeg'].includes(extension) &&
    nonNullFile.mimetype === 'image/jpeg' &&
    buffer.length >= 3 &&
    buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));

  const isPng =
    extension === '.png' &&
    nonNullFile.mimetype === 'image/png' &&
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  assertRule(isPdf || isJpeg || isPng, 'INVALID_FILE_TYPE', 'Only matching PDF, PNG and JPEG files are accepted');

  return {
    extension,
    mimeType: nonNullFile.mimetype,
  };
}

/**
 * Validates avatar image file: PNG or JPEG only, up to 5MB, matching magic number signatures.
 */
export function validateAvatarImageFile(
  file?: Express.Multer.File,
  maxSizeBytes = 5 * 1024 * 1024,
): FileValidationResult {
  assertRule(
    Boolean(file && file.size > 0 && file.size <= maxSizeBytes),
    'INVALID_FILE_SIZE',
    `A file up to ${Math.round(maxSizeBytes / (1024 * 1024))}MB is required`,
  );

  const nonNullFile = file!;
  const extension = extname(nonNullFile.originalname).toLowerCase();
  const buffer = nonNullFile.buffer;

  const isJpeg =
    ['.jpg', '.jpeg'].includes(extension) &&
    nonNullFile.mimetype === 'image/jpeg' &&
    buffer.length >= 3 &&
    buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));

  const isPng =
    extension === '.png' &&
    nonNullFile.mimetype === 'image/png' &&
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  assertRule(isJpeg || isPng, 'INVALID_FILE_TYPE', 'Only matching PNG and JPEG files are accepted for avatar');

  return {
    extension,
    mimeType: nonNullFile.mimetype,
  };
}
