import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ObjectStorageService } from '../../src/integrations/object-storage.service';
import type { AppConfiguration } from '../../src/config/configuration';

describe('ObjectStorageService Unit Tests', () => {
  let configService: { get: jest.Mock };

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    };
  });

  it('should throw ServiceUnavailableException if storage is unconfigured', async () => {
    configService.get.mockReturnValue({
      storageBucket: '',
      storageKey: '',
      storageSecret: '',
    });

    const service = new ObjectStorageService(
      configService as unknown as ConfigService<AppConfiguration, true>,
    );

    await expect(
      service.putObject({
        key: 'test/key',
        buffer: Buffer.from('test'),
        mimeType: 'text/plain',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('should clean up client on shutdown', () => {
    configService.get.mockReturnValue({
      storageBucket: 'edugrade',
      storageKey: 'key',
      storageSecret: 'secret',
      storageEndpoint: 'http://localhost:9000',
    });

    const service = new ObjectStorageService(
      configService as unknown as ConfigService<AppConfiguration, true>,
    );
    expect(() => service.onApplicationShutdown()).not.toThrow();
  });
});
