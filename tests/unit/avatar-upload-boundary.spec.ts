import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { validateAvatarImageFile } from '../../src/integrations/file-validation';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { AuthService } from '../../src/modules/auth/auth.service';

const MAX_BYTES = 5 * 1024 * 1024;

describe('Avatar multipart size boundary', () => {
  let app: INestApplication;
  const updateAvatar = jest.fn((_user: unknown, file: Express.Multer.File) => {
    validateAvatarImageFile(file);
    return Promise.resolve({ url: 'http://storage.test/avatar.png', expiresIn: 900 });
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: { updateAvatar } }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => updateAvatar.mockClear());

  it.each([MAX_BYTES - 1, MAX_BYTES])(
    'accepts a PNG of %i bytes through the actual multipart interceptor',
    async (size) => {
      const buffer = Buffer.alloc(size);
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer);
      await request(app.getHttpServer() as Server)
        .put('/api/v1/auth/me/avatar')
        .attach('file', buffer, { filename: 'avatar.png', contentType: 'image/png' })
        .expect(200);
      expect(updateAvatar).toHaveBeenCalledTimes(1);
      expect(updateAvatar.mock.calls[0]?.[1].size).toBe(size);
    },
  );

  it('rejects one byte above 5 MiB before the storage command', async () => {
    await request(app.getHttpServer() as Server)
      .put('/api/v1/auth/me/avatar')
      .attach('file', Buffer.alloc(MAX_BYTES + 1), {
        filename: 'avatar.png',
        contentType: 'image/png',
      })
      .expect(413);
    expect(updateAvatar).not.toHaveBeenCalled();
  });
});
