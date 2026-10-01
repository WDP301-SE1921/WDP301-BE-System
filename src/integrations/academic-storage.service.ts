import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { AppConfiguration } from '../config/configuration';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { AcademicRepository } from '../modules/academic/academic.repository';
import { assertRule, roles } from '../modules/academic/academic-access.service';

@Injectable()
export class AcademicStorageService {
  constructor(
    private readonly config: ConfigService<AppConfiguration, true>,
    private readonly repo: AcademicRepository,
  ) {}
  private client(): { client: S3Client; bucket: string } {
    const c = this.config.get('academic', { infer: true });
    if (!c.storageBucket || !c.storageKey || !c.storageSecret)
      throw new ServiceUnavailableException('Object storage is not configured');
    return {
      client: new S3Client({
        region: c.storageRegion,
        endpoint: c.storageEndpoint || undefined,
        forcePathStyle: !!c.storageEndpoint,
        credentials: { accessKeyId: c.storageKey, secretAccessKey: c.storageSecret },
        maxAttempts: 2,
      }),
      bucket: c.storageBucket,
    };
  }
  async upload(user: AuthenticatedUser, file?: Express.Multer.File): Promise<unknown> {
    roles(user, 'PARENT');
    assertRule(
      file && file.size > 0 && file.size <= 10 * 1024 * 1024,
      'INVALID_FILE_SIZE',
      'A file up to 10MB is required',
    );
    const extension = extname(file.originalname).toLowerCase();
    const valid =
      (extension === '.pdf' &&
        file.mimetype === 'application/pdf' &&
        file.buffer.subarray(0, 5).toString() === '%PDF-') ||
      (['.jpg', '.jpeg'].includes(extension) &&
        file.mimetype === 'image/jpeg' &&
        file.buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) ||
      (extension === '.png' &&
        file.mimetype === 'image/png' &&
        file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    assertRule(valid, 'INVALID_FILE_TYPE', 'Only matching PDF, PNG and JPEG files are accepted');
    const { client, bucket } = this.client();
    const storageKey = `submissions/${user.id}/${randomUUID()}${extension}`;
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: storageKey,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
      try {
        return await this.repo.db.fileAsset.create({
          data: {
            ownerId: user.id,
            storageKey,
            name: file.originalname.slice(0, 255),
            mimeType: file.mimetype,
            size: file.size,
          },
          select: { id: true, name: true, mimeType: true, size: true },
        });
      } catch (error) {
        await client
          .send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }))
          .catch(() => undefined);
        throw error;
      }
    } finally {
      client.destroy();
    }
  }
  async download(user: AuthenticatedUser, id: string): Promise<unknown> {
    roles(user, 'PARENT', 'TEACHER');
    const file = await this.repo.db.fileAsset.findUniqueOrThrow({ where: { id } });
    const permitted =
      file.ownerId === user.id ||
      (user.role === 'TEACHER' &&
        (await this.repo.db.submissionFile.count({
          where: {
            fileId: id,
            submission: {
              recipient: { assignment: { teacherId: user.id, class: { teacherId: user.id } } },
            },
          },
        })));
    assertRule(permitted, 'FORBIDDEN', 'File is not accessible to this user');
    const { client, bucket } = this.client();
    try {
      return {
        url: await getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: bucket,
            Key: file.storageKey,
            ResponseContentDisposition: 'attachment',
          }),
          { expiresIn: 60 },
        ),
        expiresIn: 60,
      };
    } finally {
      client.destroy();
    }
  }
}
