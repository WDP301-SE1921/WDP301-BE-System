import {
  Injectable,
  ServiceUnavailableException,
  OnApplicationShutdown,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfiguration } from '../config/configuration';

export interface PresignedUrlOptions {
  expiresInSeconds?: number;
  inline?: boolean;
  contentType?: string;
  filename?: string;
}

function contentDisposition(inline: boolean | undefined, filename?: string): string {
  const kind = inline ? 'inline' : 'attachment';
  if (!filename) return kind;
  const clean = filename.replace(/[\r\n]/g, '').slice(0, 180);
  const fallback = clean.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(clean).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

@Injectable()
export class ObjectStorageService implements OnApplicationShutdown {
  private readonly logger = new Logger(ObjectStorageService.name);
  private internalClient: S3Client | null = null;
  private signerClient: S3Client | null = null;

  constructor(private readonly config: ConfigService<AppConfiguration, true>) {}

  available(): boolean {
    const c = this.config.get('academic', { infer: true });
    return Boolean(c.storageBucket && c.storageKey && c.storageSecret);
  }

  private getStorageConfig(): {
    endpoint: string;
    publicEndpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
  } {
    const c = this.config.get('academic', { infer: true });
    if (!c.storageBucket || !c.storageKey || !c.storageSecret) {
      throw new ServiceUnavailableException('Object storage is not configured');
    }
    return {
      endpoint: c.storageEndpoint || 'http://localhost:9000',
      publicEndpoint: c.storagePublicEndpoint || c.storageEndpoint || 'http://localhost:9000',
      region: c.storageRegion || 'us-east-1',
      bucket: c.storageBucket,
      accessKey: c.storageKey,
      secretKey: c.storageSecret,
    };
  }

  private getInternalClient(): { client: S3Client; bucket: string } {
    const cfg = this.getStorageConfig();
    if (!this.internalClient) {
      this.internalClient = new S3Client({
        region: cfg.region,
        endpoint: cfg.endpoint || undefined,
        forcePathStyle: true,
        credentials: {
          accessKeyId: cfg.accessKey,
          secretAccessKey: cfg.secretKey,
        },
        maxAttempts: 2,
      });
    }
    return { client: this.internalClient, bucket: cfg.bucket };
  }

  private getSignerClient(): { client: S3Client; bucket: string } {
    const cfg = this.getStorageConfig();
    // If public endpoint is specified, use an S3Client bound to the public endpoint for signing URLs
    if (!this.signerClient) {
      this.signerClient = new S3Client({
        region: cfg.region,
        endpoint: cfg.publicEndpoint || cfg.endpoint || undefined,
        forcePathStyle: true,
        credentials: {
          accessKeyId: cfg.accessKey,
          secretAccessKey: cfg.secretKey,
        },
        maxAttempts: 2,
      });
    }
    return { client: this.signerClient, bucket: cfg.bucket };
  }

  async putObject(input: {
    key: string;
    buffer: Buffer;
    mimeType: string;
    timeoutMs?: number;
  }): Promise<void> {
    const { client, bucket } = this.getInternalClient();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          Body: input.buffer,
          ContentType: input.mimeType,
        }),
        { abortSignal: AbortSignal.timeout(input.timeoutMs ?? 30000) },
      );
    } catch (error) {
      this.logger.error(`Failed to put object at key "${input.key}": ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        `Failed to store object: ${(error as Error).message || 'Storage error'}`,
      );
    }
  }

  async readObject(key: string, maxBytes = 10 * 1024 * 1024): Promise<Buffer> {
    const { client, bucket } = this.getInternalClient();
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(30000),
    });
    if (!result.Body || (result.ContentLength ?? 0) > maxBytes)
      throw new ServiceUnavailableException('File exceeds processing limit');
    const bytes = await result.Body.transformToByteArray();
    if (bytes.length > maxBytes)
      throw new ServiceUnavailableException('File exceeds processing limit');
    return Buffer.from(bytes);
  }

  async deleteObject(key: string): Promise<void> {
    const { client, bucket } = this.getInternalClient();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      this.logger.warn(`Failed to delete object at key "${key}": ${(error as Error).message}`);
    }
  }

  async createSignedGetUrl(
    key: string,
    options: PresignedUrlOptions = {},
  ): Promise<{ url: string; expiresIn: number }> {
    const { client, bucket } = this.getSignerClient();
    const expiresIn = options.expiresInSeconds ?? 60;
    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(options.inline, options.filename),
        ...(options.contentType ? { ResponseContentType: options.contentType } : {}),
      });

      const url = await getSignedUrl(client, command, { expiresIn });
      return { url, expiresIn };
    } catch (error) {
      this.logger.error(`Failed to sign GET URL for key "${key}": ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        `Failed to generate object access URL: ${(error as Error).message || 'Storage error'}`,
      );
    }
  }

  onApplicationShutdown(): void {
    if (this.internalClient) {
      try {
        this.internalClient.destroy();
      } catch (err) {
        this.logger.warn(`Error destroying internal S3 client: ${(err as Error).message}`);
      }
      this.internalClient = null;
    }
    if (this.signerClient) {
      try {
        this.signerClient.destroy();
      } catch (err) {
        this.logger.warn(`Error destroying signer S3 client: ${(err as Error).message}`);
      }
      this.signerClient = null;
    }
  }
}
