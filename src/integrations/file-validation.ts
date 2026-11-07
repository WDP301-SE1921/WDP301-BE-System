import { extname } from 'node:path';
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../common/errors/app.error';
import { assertRule } from '../modules/academic/academic-access.service';

export interface FileValidationResult {
  extension: string;
  mimeType: string;
}

export interface ChatAttachmentValidationResult extends FileValidationResult {
  filename: string;
  isImage: boolean;
}

const CHAT_FILE_TYPES = new Map<string, readonly string[]>([
  ['.pdf', ['application/pdf']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation']],
  ['.csv', ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel']],
  ['.txt', ['text/plain']],
  ['.zip', ['application/zip', 'application/x-zip-compressed']],
]);

function chatFileError(code: string, message: string): never {
  throw new AppError(code, message, HttpStatus.BAD_REQUEST);
}

/** Images and common office files only. Executable, HTML and SVG content is never accepted. */
export function validateChatAttachment(
  file?: Express.Multer.File,
  maxSizeBytes = 10 * 1024 * 1024,
): ChatAttachmentValidationResult {
  if (!file || file.size <= 0 || file.size > maxSizeBytes)
    chatFileError('CHAT_ATTACHMENT_SIZE_INVALID', 'Attachment must be between 1 byte and 10 MB');

  const extension = extname(file.originalname).toLowerCase();
  const buffer = file.buffer;
  const jpeg =
    ['.jpg', '.jpeg'].includes(extension) &&
    file.mimetype === 'image/jpeg' &&
    buffer.length >= 3 &&
    buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const png =
    extension === '.png' &&
    file.mimetype === 'image/png' &&
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const gif =
    extension === '.gif' &&
    file.mimetype === 'image/gif' &&
    buffer.length >= 6 &&
    ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  const webp =
    extension === '.webp' &&
    file.mimetype === 'image/webp' &&
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  const isImage = jpeg || png || gif || webp;

  if (!isImage) {
    const mimeTypes = CHAT_FILE_TYPES.get(extension);
    if (!mimeTypes?.includes(file.mimetype))
      chatFileError(
        'CHAT_ATTACHMENT_TYPE_INVALID',
        'Only images, PDF, Office, CSV, TXT and ZIP files are accepted',
      );
    const isPdf = extension === '.pdf';
    if (isPdf && (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-'))
      chatFileError('CHAT_ATTACHMENT_TYPE_INVALID', 'PDF content does not match its extension');
    const isZipContainer = ['.docx', '.xlsx', '.pptx', '.zip'].includes(extension);
    if (
      isZipContainer &&
      (buffer.length < 4 || !buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
    )
      chatFileError('CHAT_ATTACHMENT_TYPE_INVALID', 'Archive content does not match its extension');
  }

  const cleanName = [...file.originalname]
    .map((character) => {
      const code = character.charCodeAt(0);
      return character === '/' || character === '\\' || code <= 31 || code === 127
        ? '_'
        : character;
    })
    .join('')
    .trim()
    .slice(0, 180);
  if (!cleanName) chatFileError('CHAT_ATTACHMENT_NAME_INVALID', 'Attachment filename is invalid');
  return { extension, mimeType: file.mimetype, filename: cleanName, isImage };
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

  assertRule(
    isPdf || isJpeg || isPng,
    'INVALID_FILE_TYPE',
    'Only matching PDF, PNG and JPEG files are accepted',
  );

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

  assertRule(
    isJpeg || isPng,
    'INVALID_FILE_TYPE',
    'Only matching PNG and JPEG files are accepted for avatar',
  );

  return {
    extension,
    mimeType: nonNullFile.mimetype,
  };
}
