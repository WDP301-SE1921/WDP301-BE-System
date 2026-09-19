import { ServiceUnavailableException } from '@nestjs/common';

import type { DatabaseService } from '../../src/database/orm/database.service';
import { HealthService } from '../../src/modules/health/health.service';

describe('HealthService', () => {
  it('reports liveness without checking infrastructure', () => {
    const isReady = jest.fn();
    const database = { isReady } as unknown as DatabaseService;
    const service = new HealthService(database);

    expect(service.live().status).toBe('ok');
    expect(isReady).not.toHaveBeenCalled();
  });

  it('reports readiness when the database responds', async () => {
    const database = { isReady: jest.fn().mockResolvedValue(true) } as unknown as DatabaseService;
    const service = new HealthService(database);

    await expect(service.ready()).resolves.toMatchObject({
      status: 'ok',
      dependencies: { database: 'up' },
    });
  });

  it('rejects readiness when the database is unavailable', async () => {
    const database = { isReady: jest.fn().mockResolvedValue(false) } as unknown as DatabaseService;
    const service = new HealthService(database);

    await expect(service.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
