import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '../../src/config/configuration';
import type { Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import * as mysql from 'mysql2/promise';
import * as request from 'supertest';

import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';

const TEST_DATABASE_URL = 'mysql://root:admin123@localhost:3306/edugrade_auth_test';

interface AuthEnvelope {
  success: true;
  data: {
    user: {
      id: string;
      email: string;
      role: 'PARENT';
      status: 'ACTIVE';
    };
    tokens: {
      accessToken: string;
      refreshToken: string;
      tokenType: 'Bearer';
      expiresIn: number;
    };
  };
}

describe('Auth endpoints (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:8081';
    process.env.SWAGGER_ENABLED = 'false';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-test-access-secret-test-access-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-test-refresh-secret-test-refresh-secret';
    process.env.JWT_ISSUER = 'edugrade-api-test';
    process.env.JWT_AUDIENCE = 'edugrade-clients-test';
    process.env.JWT_ACCESS_TTL_SECONDS = '900';
    process.env.JWT_REFRESH_TTL_SECONDS = '604800';

    await recreateTestDatabase();
    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'pipe',
      },
    );

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(validateEnvironment(process.env)))
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
  }, 60000);

  afterAll(async () => {
    if (app) await app.close();
    await dropTestDatabase();
  });

  it('registers a parent, logs in, rotates refresh tokens, and revokes the session on logout', async () => {
    const email = `parent-${Date.now()}@example.com`;
    const password = 'StrongPass123!';

    const registerResponse = await request(httpServer)
      .post('/api/v1/auth/register')
      .send({
        email: ` ${email.toUpperCase()} `,
        password,
        displayName: 'Parent One',
        phone: '0901234567',
      })
      .expect(201);

    const registered = registerResponse.body as AuthEnvelope;
    expect(registered.data.user).toMatchObject({
      email,
      role: 'PARENT',
      status: 'ACTIVE',
    });
    expect(registered.data.tokens.tokenType).toBe('Bearer');
    expect(registered.data.tokens.accessToken).toBeDefined();
    expect(registered.data.tokens.refreshToken).toBeDefined();

    await request(httpServer)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${registered.data.tokens.accessToken}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as { data: { email: string } };
        expect(body.data.email).toBe(email);
      });

    const loginResponse = await request(httpServer)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const loggedIn = loginResponse.body as AuthEnvelope;

    const refreshResponse = await request(httpServer)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loggedIn.data.tokens.refreshToken })
      .expect(200);
    const refreshed = refreshResponse.body as AuthEnvelope;
    expect(refreshed.data.tokens.refreshToken).not.toBe(loggedIn.data.tokens.refreshToken);

    await request(httpServer)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refreshed.data.tokens.accessToken}`)
      .expect(200);

    await request(httpServer)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${refreshed.data.tokens.accessToken}`)
      .expect(200);

    await request(httpServer)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refreshed.data.tokens.accessToken}`)
      .expect(401);

    const replayLoginResponse = await request(httpServer)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const replayLogin = replayLoginResponse.body as AuthEnvelope;

    await request(httpServer)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: replayLogin.data.tokens.refreshToken })
      .expect(200);

    await request(httpServer)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: replayLogin.data.tokens.refreshToken })
      .expect(401);
  });
});

async function recreateTestDatabase(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const database = url.pathname.slice(1);
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  });
  await connection.query('DROP DATABASE IF EXISTS ??', [database]);
  await connection.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [
    database,
  ]);
  await connection.end();
}

async function dropTestDatabase(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const database = url.pathname.slice(1);
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  });
  await connection.query('DROP DATABASE IF EXISTS ??', [database]);
  await connection.end();
}
