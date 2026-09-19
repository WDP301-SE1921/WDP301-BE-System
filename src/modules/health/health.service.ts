import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { DatabaseService } from '../../database/orm/database.service';

export interface HealthStatus {
  status: 'ok';
  timestamp: string;
}

export interface ReadinessStatus extends HealthStatus {
  dependencies: { database: 'up' };
}

@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  live(): HealthStatus {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  async ready(): Promise<ReadinessStatus> {
    if (!(await this.database.isReady())) {
      throw new ServiceUnavailableException('Database is unavailable');
    }
    return {
      ...this.live(),
      dependencies: { database: 'up' },
    };
  }
}
