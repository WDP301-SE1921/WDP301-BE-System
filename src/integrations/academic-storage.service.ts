import type { FileAsset } from '@prisma/client';
import { assignedTeacherWhere } from '../modules/registration-flow/class-teacher';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { AcademicRepository } from '../modules/academic/academic.repository';
import { assertRule, roles } from '../modules/academic/academic-access.service';
import { ObjectStorageService } from './object-storage.service';
import { validateAcademicSubmissionFile } from './file-validation';

@Injectable()
export class AcademicStorageService {
  private readonly logger = new Logger(AcademicStorageService.name);

  constructor(
    private readonly objectStorage: ObjectStorageService,
    private readonly repo: AcademicRepository,
  ) {}

  async upload(user: AuthenticatedUser, file?: Express.Multer.File): Promise<unknown> {
    roles(user, 'PARENT', 'TEACHER');
    const { extension, mimeType } = validateAcademicSubmissionFile(file);
    const nonNullFile = file!;

    const storageKey = `submissions/${user.id}/${randomUUID()}${extension}`;

    // Upload to object storage first
    await this.objectStorage.putObject({
      key: storageKey,
      buffer: nonNullFile.buffer,
      mimeType,
      timeoutMs: 30000,
    });

    try {
      return await this.repo.db.fileAsset.create({
        data: {
          ownerId: user.id,
          storageKey,
          name: nonNullFile.originalname.slice(0, 255),
          mimeType,
          size: nonNullFile.size,
        },
        select: { id: true, name: true, mimeType: true, size: true },
      });
    } catch (error) {
      // Compensating deletion on DB failure
      try {
        await this.objectStorage.deleteObject(storageKey);
      } catch (cleanupErr) {
        this.logger.error(
          `Compensating cleanup failed for key "${storageKey}": ${(cleanupErr as Error).message}`,
        );
      }
      throw error;
    }
  }

  private async checkFileAccess(user: AuthenticatedUser, id: string): Promise<FileAsset> {
    roles(user, 'PARENT', 'TEACHER');
    const file = await this.repo.db.fileAsset.findUniqueOrThrow({ where: { id } });
    if (file.ownerId === user.id) return file;
    const assignmentAccess = await this.repo.db.assignmentFile.count({
      where: {
        fileId: id,
        ...(user.role === 'PARENT'
          ? {
              teacherOnly: false,
              assignment: {
                status: { not: 'DRAFT' },
                recipients: {
                  some: {
                    enrollment: {
                      status: { not: 'PENDING_LINK' },
                      studentProfile: { parentProfile: { userId: user.id } },
                    },
                  },
                },
              },
            }
          : { assignment: { class: assignedTeacherWhere(user.id, new Date()) } }),
      },
    });
    const permitted =
      assignmentAccess > 0 ||
      file.ownerId === user.id ||
      (user.role === 'TEACHER' &&
        (await this.repo.db.submissionFile.count({
          where: {
            fileId: id,
            submission: {
              recipient: { assignment: { class: assignedTeacherWhere(user.id, new Date()) } },
            },
          },
        })) > 0);
    assertRule(permitted, 'FORBIDDEN', 'File is not accessible to this user');
    return file;
  }

  async download(user: AuthenticatedUser, id: string): Promise<{ url: string; expiresIn: number }> {
    const file = await this.checkFileAccess(user, id);
    return this.objectStorage.createSignedGetUrl(file.storageKey, {
      expiresInSeconds: 60,
      inline: false,
    });
  }

  async preview(user: AuthenticatedUser, id: string): Promise<{ url: string; expiresIn: number }> {
    const file = await this.checkFileAccess(user, id);
    const isImage = file.mimeType === 'image/png' || file.mimeType === 'image/jpeg';
    return this.objectStorage.createSignedGetUrl(file.storageKey, {
      expiresInSeconds: 300,
      inline: isImage || file.mimeType === 'application/pdf',
      contentType: file.mimeType,
    });
  }
}
