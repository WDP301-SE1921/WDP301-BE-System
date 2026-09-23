import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import * as request from 'supertest';

import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { DatabaseService } from '../../src/database/orm/database.service';

interface SuccessEnvelope {
  success: true;
  data: {
    status: 'ok';
    dependencies?: { database: 'up' };
  };
}

interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

describe('Health endpoints (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  const database = { isReady: jest.fn() };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'mysql://root:admin123@localhost:3306/edugrade_health_test';
    process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:8081';
    process.env.SWAGGER_ENABLED = 'false';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-test-access-secret-test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-test-refresh-secret-test-refresh-secret';
    process.env.JWT_ISSUER = 'edugrade-api-test';
    process.env.JWT_AUDIENCE = 'edugrade-clients-test';
    process.env.JWT_ACCESS_TTL_SECONDS = '900';
    process.env.JWT_REFRESH_TTL_SECONDS = '604800';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue(database)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    database.isReady.mockReset();
  });

  it('serves the versioned liveness contract for web and mobile clients', async () => {
    const response = await request(httpServer).get('/api/v1/health/live').expect(200);

    const body = response.body as SuccessEnvelope;
    expect(response.headers['x-request-id']).toBeDefined();
    expect(body).toMatchObject({
      success: true,
      data: { status: 'ok' },
    });
    expect(database.isReady).not.toHaveBeenCalled();
  });

  it('serves readiness when required infrastructure is available', async () => {
    database.isReady.mockResolvedValue(true);

    await request(httpServer)
      .get('/api/v1/health/ready')
      .expect(200)
      .expect((response) => {
        const body = response.body as SuccessEnvelope;
        expect(body).toMatchObject({
          success: true,
          data: { status: 'ok', dependencies: { database: 'up' } },
        });
      });
  });

  it('uses the standard error contract when readiness fails', async () => {
    database.isReady.mockResolvedValue(false);

    await request(httpServer)
      .get('/api/v1/health/ready')
      .expect(503)
      .expect((response) => {
        const body = response.body as ErrorEnvelope;
        expect(body).toMatchObject({
          success: false,
          error: {
            code: 'HTTP_ERROR',
            message: 'Database is unavailable',
          },
        });
        expect(body.error.requestId).toBeDefined();
      });
  });
});
