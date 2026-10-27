import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as http from 'http';

describe('MinIO Live Docker Smoke Test', () => {
  let client: S3Client;
  const testKey = `smoke-test/${Date.now()}.png`;
  const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

  beforeAll(() => {
    client = new S3Client({
      region: 'us-east-1',
      endpoint: 'http://127.0.0.1:9000',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'edugrade_app',
        secretAccessKey: 'edugrade_app_secret123',
      },
    });
  });

  afterAll(() => {
    client.destroy();
  });

  it('should upload object with edugrade_app credentials and download via presigned url', async () => {
    // 1. Put object
    await client.send(
      new PutObjectCommand({
        Bucket: 'edugrade',
        Key: testKey,
        Body: pngBuffer,
        ContentType: 'image/png',
      }),
    );

    // 2. Generate signed GET URL
    const signedUrl = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: 'edugrade',
        Key: testKey,
        ResponseContentDisposition: 'inline',
      }),
      { expiresIn: 60 },
    );

    expect(signedUrl).toContain('http://127.0.0.1:9000/edugrade/');

    // 3. Perform HTTP GET using the signed URL
    const fetchStatus = await new Promise<number>((resolve, reject) => {
      http.get(signedUrl, (res) => {
        res.resume();
        resolve(res.statusCode || 0);
      }).on('error', reject);
    });

    expect(fetchStatus).toBe(200);

    // 4. Verify anonymous access without signed token gets 403 Forbidden
    const unsignedUrl = `http://127.0.0.1:9000/edugrade/${testKey}`;
    const unsignedStatus = await new Promise<number>((resolve, reject) => {
      http.get(unsignedUrl, (res) => {
        res.resume();
        resolve(res.statusCode || 0);
      }).on('error', reject);
    });

    expect(unsignedStatus).toBe(403);
  });
});
