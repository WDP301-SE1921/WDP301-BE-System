import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { UserRole } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import * as bcrypt from 'bcrypt';
import * as mysql from 'mysql2/promise';
import * as request from 'supertest';

import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { validateEnvironment } from '../../src/config/configuration';
import { DatabaseService } from '../../src/database/orm/database.service';
import type { ParentSuggestionDto } from '../../src/modules/registration-flow/dto/registration-flow.dto';

interface Envelope<T> {
  success: true;
  data: T;
}
interface AuthData {
  user: { id: string; email: string; role: UserRole };
  tokens: { accessToken: string };
}
interface WithId {
  id: string;
}

describe('Staff parent search and registration (MySQL + authenticated HTTP)', () => {
  const databaseName = `edugrade_reg_test_${Date.now()}_${process.pid}`;
  const password = 'RegistrationFixture123!';
  const tokens: Partial<Record<UserRole, string>> = {};
  let sourceUrl: URL;
  let createdDatabase = false;
  let app: INestApplication | undefined;
  let httpServer: Server;
  let db: DatabaseService;
  let staffId: string;
  let studentId: string;
  let classId: string;
  let registrationId: string;
  let otherParentToken: string;
  const tomorrow = new Date(Date.now() + 7 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
  const call = (
    role: UserRole,
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
  ): request.Test =>
    request(httpServer)[method](`/api/v1/${path}`).set('Authorization', `Bearer ${tokens[role]}`);

  function assertDatabaseName(): void {
    if (!/^edugrade_reg_test_\d+_\d+$/.test(databaseName))
      throw new Error('Invalid isolated test database name');
  }
  function adminConnection(): Promise<mysql.Connection> {
    return mysql.createConnection({
      host: sourceUrl.hostname,
      port: Number(sourceUrl.port || 3306),
      user: decodeURIComponent(sourceUrl.username),
      password: decodeURIComponent(sourceUrl.password),
    });
  }

  beforeAll(async () => {
    const configuredUrl = process.env.REGISTRATION_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!configuredUrl)
      throw new Error(
        'Set REGISTRATION_TEST_DATABASE_URL to a local MySQL connection for isolated integration tests.',
      );
    sourceUrl = new URL(configuredUrl);
    if (sourceUrl.protocol !== 'mysql:') throw new Error('Registration tests require MySQL.');
    assertDatabaseName();
    const connection = await adminConnection();
    try {
      // CREATE without IF NOT EXISTS: never overwrite or reuse an existing database.
      await connection.query(
        'CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
        [databaseName],
      );
      createdDatabase = true;
    } finally {
      await connection.end();
    }
    const testUrl = new URL(sourceUrl);
    testUrl.pathname = `/${databaseName}`;
    Object.assign(process.env, {
      NODE_ENV: 'test',
      THROTTLE_LIMIT_PER_MINUTE: '100000',
      DATABASE_URL: testUrl.toString(),
      CORS_ORIGINS: 'http://localhost:3001',
      SWAGGER_ENABLED: 'false',
      JWT_ACCESS_SECRET: 'registration-test-access-secret-at-least-32-characters',
      JWT_REFRESH_SECRET: 'registration-test-refresh-secret-at-least-32-characters',
      SMTP_URL: '',
      MAIL_FROM: '',
      AI_CHAT_URL: '',
      AI_API_KEY: '',
      STORAGE_BUCKET: '',
    });
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
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    httpServer = app.getHttpServer() as Server;
    db = app.get(DatabaseService);
    const passwordHash = await bcrypt.hash(password, 12);
    const roles: UserRole[] = ['STAFF', 'MANAGER', 'TEACHER', 'CURRICULUM_DESIGNER'];
    for (const role of roles) {
      const actor = await db.user.create({
        data: { email: `parent${role.toLowerCase()}@example.com`, role, passwordHash },
      });
      if (role === 'STAFF') staffId = actor.id;
      const login = await request(httpServer)
        .post('/api/v1/auth/login')
        .send({ email: actor.email, password })
        .expect(200);
      tokens[role] = (login.body as Envelope<AuthData>).data.tokens.accessToken;
    }
    // Actual public signup has no invitation credential; only the fixture marks the email verified.
    const signup = await request(httpServer)
      .post('/api/v1/auth/register')
      .send({ email: ' PARENTMAIN@EXAMPLE.COM ', password })
      .expect(201);
    const parent = (signup.body as Envelope<AuthData>).data;
    expect(parent.user.role).toBe('PARENT');
    tokens.PARENT = parent.tokens.accessToken;
    await db.user.update({ where: { id: parent.user.id }, data: { emailVerifiedAt: new Date() } });
    for (const fullName of ['Con thứ nhất', 'Con thứ hai']) {
      const child = await call('PARENT', 'post', 'me/students')
        .send({ fullName, grade: 8 })
        .expect(201);
      studentId = (child.body as Envelope<WithId>).data.id;
    }
    await db.user.createMany({
      data: Array.from({ length: 14 }, (_, index) => ({
        email: `parent${String(index).padStart(2, '0')}@example.com`,
        role: 'PARENT' as const,
        status: index === 0 ? ('DISABLED' as const) : ('ACTIVE' as const),
      })),
    });
    await db.user.create({
      data: { email: 'literal%_@example.com', role: 'PARENT', displayName: 'Literal search' },
    });
    const other = await db.user.create({
      data: {
        email: 'anotherfamily@example.com',
        role: 'PARENT',
        passwordHash,
        parentProfile: { create: {} },
      },
    });
    const otherLogin = await request(httpServer)
      .post('/api/v1/auth/login')
      .send({ email: other.email, password })
      .expect(200);
    otherParentToken = (otherLogin.body as Envelope<AuthData>).data.tokens.accessToken;
    const program = await call('MANAGER', 'post', 'programs')
      .send({ name: 'Toán 8', subject: 'Toán', grade: 8 })
      .expect(201);
    const classroom = await call('MANAGER', 'post', 'classes')
      .send({
        programId: (program.body as Envelope<WithId>).data.id,
        name: 'Toán 8A',
        capacity: 20,
        monthlyFee: 800000,
        isOpen: false,
      })
      .expect(201);
    classId = (classroom.body as Envelope<WithId>).data.id;
    const weekday = new Date(`${tomorrow}T00:00:00Z`).getUTCDay() || 7;
    await call('MANAGER', 'post', `classes/${classId}/schedules`)
      .send({ schedules: [{ weekday, startTime: '18:00', endTime: '20:00' }] })
      .expect(201);
    await call('MANAGER', 'patch', `classes/${classId}`).send({ isOpen: true }).expect(200);
    const draft = await call('STAFF', 'post', 'registrations')
      .send({ targetStudentId: studentId, classId, startDate: tomorrow, packageMonths: 3 })
      .expect(201);
    registrationId = (draft.body as Envelope<WithId>).data.id;
  }, 60_000);

  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      if (createdDatabase) {
        assertDatabaseName();
        const connection = await adminConnection();
        try {
          await connection.query('DROP DATABASE ??', [databaseName]);
        } finally {
          await connection.end();
        }
      }
    }
  });

  it('attaches enrollment immediately after staff confirmation, replays payment once and preserves parent receipts', async () => {
    expect(await db.enrollment.count({ where: { registrationOrderId: registrationId } })).toBe(0);
    const confirm = (): request.Test =>
      call('STAFF', 'post', `registrations/${registrationId}/confirm-payment`)
        .set('Idempotency-Key', 'registration-fixture-payment')
        .send({});
    const first = await confirm().expect(201);
    const replay = await confirm().expect(201);
    expect(replay.body).toEqual(first.body);
    expect(await db.payment.count({ where: { registrationOrderId: registrationId } })).toBe(1);
    const payment = await db.payment.findUniqueOrThrow({
      where: { registrationOrderId: registrationId },
    });
    expect(payment.confirmedByManagerId).toBe(staffId);
    expect(
      await db.enrollment.findUniqueOrThrow({ where: { registrationOrderId: registrationId } }),
    ).toMatchObject({ studentProfileId: studentId, status: 'ACTIVE' });
    await call('PARENT', 'get', `registrations/${registrationId}/receipt`).expect(200);
    await call('PARENT', 'get', `me/students/${studentId}/enrollments`).expect(200);
  });

  it('searches partial email case-insensitively, sorts, limits and returns only safe parent summaries', async () => {
    const response = await call('STAFF', 'get', 'parents/search')
      .query({ email: ' PARENT ', limit: 3 })
      .expect(200);
    const rows = (response.body as Envelope<ParentSuggestionDto[]>).data;
    expect(rows.map((row) => row.email)).toEqual([
      'parent00@example.com',
      'parent01@example.com',
      'parent02@example.com',
    ]);
    expect(rows[0].status).toBe('DISABLED');
    rows.forEach((row) =>
      expect(Object.keys(row).sort()).toEqual(['displayName', 'email', 'id', 'status']),
    );
    const defaultLimit = await call('STAFF', 'get', 'parents/search')
      .query({ email: 'parent' })
      .expect(200);
    expect((defaultLimit.body as Envelope<ParentSuggestionDto[]>).data).toHaveLength(10);
  });

  it('treats percent/underscore and SQL-looking input as literal text and returns empty arrays for no match', async () => {
    const literal = await call('STAFF', 'get', 'parents/search').query({ email: '%_' }).expect(200);
    expect((literal.body as Envelope<ParentSuggestionDto[]>).data.map((row) => row.email)).toEqual([
      'literal%_@example.com',
    ]);
    for (const email of ['no-matching-family', "parent' OR 1=1 --"]) {
      const empty = await call('STAFF', 'get', 'parents/search').query({ email }).expect(200);
      expect((empty.body as Envelope<ParentSuggestionDto[]>).data).toEqual([]);
    }
  });

  it.each([
    { email: 'p' },
    { email: '  ' },
    {},
    { email: 'p'.repeat(256) },
    { email: 'pa', limit: 0 },
    { email: 'pa', limit: 11 },
    { email: 'pa', limit: 1.5 },
    { email: 'pa', limit: 'invalid' },
    { email: 'pa', role: 'MANAGER' },
  ])('rejects invalid search query %j', async (query) => {
    const response = await call('STAFF', 'get', 'parents/search').query(query).expect(400);
    expect(response.body as unknown).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    });
  });

  it('requires authentication and permits parent suggestions only to staff', async () => {
    await request(httpServer).get('/api/v1/parents/search?email=pa').expect(401);
    for (const role of ['MANAGER', 'TEACHER', 'CURRICULUM_DESIGNER', 'PARENT'] as UserRole[])
      await call(role, 'get', 'parents/search').query({ email: 'pa' }).expect(403);
    for (const role of ['STAFF', 'MANAGER'] as UserRole[]) {
      const lookup = await call(role, 'get', 'parents/lookup')
        .query({ email: 'parentmain@example.com' })
        .expect(200);
      expect(
        (lookup.body as Envelope<{ parentProfile: { students: WithId[] } }>).data.parentProfile
          .students,
      ).toHaveLength(2);
    }
  });

  it.each(['MANAGER', 'TEACHER', 'CURRICULUM_DESIGNER', 'PARENT'] as UserRole[])(
    'forbids %s from creating, cancelling or confirming registrations, even with a replay key',
    async (role) => {
      await call(role, 'post', 'registrations')
        .send({ targetStudentId: studentId, classId, startDate: tomorrow, packageMonths: 3 })
        .expect(403);
      await call(role, 'post', `registrations/${registrationId}/cancel`).send({}).expect(403);
      await call(role, 'post', `registrations/${registrationId}/confirm-payment`)
        .set('Idempotency-Key', 'registration-fixture-payment')
        .send({})
        .expect(403);
      expect(await db.payment.count({ where: { registrationOrderId: registrationId } })).toBe(1);
    },
  );

  it('forbids manager/teacher reads and preserves reads only for staff or the owning parent', async () => {
    for (const path of [
      `registrations/${registrationId}`,
      `registrations/${registrationId}/receipt`,
    ]) {
      await call('STAFF', 'get', path).expect(200);
      await call('PARENT', 'get', path).expect(200);
      await call('MANAGER', 'get', path).expect(403);
      await call('TEACHER', 'get', path).expect(403);
      await request(httpServer)
        .get(`/api/v1/${path}`)
        .set('Authorization', `Bearer ${otherParentToken}`)
        .expect(403);
    }
  });

  describe('registration contract fixes', () => {
    const dayAfter = (days: number): string =>
      new Date(Date.parse(`${tomorrow}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    const weekday = (): number => new Date(`${tomorrow}T00:00:00Z`).getUTCDay() || 7;
    const kids: Record<string, string> = {};
    const classes: Record<string, string> = {};
    let programId: string;

    const draft = (
      studentKey: string,
      classKey: string,
      startDate: string,
      months = 1,
      key?: string,
    ): request.Test => {
      const req = call('STAFF', 'post', 'registrations');
      if (key) req.set('Idempotency-Key', key);
      return req.send({
        targetStudentId: kids[studentKey],
        classId: classes[classKey],
        startDate,
        packageMonths: months,
      });
    };
    const pay = (id: string, key: string, body: object = {}): request.Test =>
      call('STAFF', 'post', `registrations/${id}/confirm-payment`)
        .set('Idempotency-Key', key)
        .send(body);

    beforeAll(async () => {
      programId = (await db.program.findFirstOrThrow()).id;
      for (const name of ['A', 'B', 'C', 'D']) {
        const child = await call('PARENT', 'post', 'me/students')
          .send({ fullName: `Kid ${name}`, grade: 8 })
          .expect(201);
        kids[name] = (child.body as Envelope<WithId>).data.id;
      }
      const slots: Array<[string, string, string, number]> = [
        ['one', '08:00', '10:00', 1],
        ['two', '10:00', '12:00', 2],
        ['three', '12:00', '14:00', 5],
      ];
      for (const [key, startTime, endTime, capacity] of slots) {
        const created = await call('MANAGER', 'post', 'classes')
          .send({ programId, name: `Seats ${key}`, capacity, monthlyFee: 500000 })
          .expect(201);
        classes[key] = (created.body as Envelope<WithId>).data.id;
        await call('MANAGER', 'post', `classes/${classes[key]}/schedules`)
          .send({ schedules: [{ weekday: weekday(), startTime, endTime }] })
          .expect(201);
        await call('MANAGER', 'patch', `classes/${classes[key]}`)
          .send({ isOpen: true })
          .expect(200);
      }
    }, 60_000);

    it('cancels drafts idempotently and never turns a missing or paid order into a 500', async () => {
      const created = await draft('D', 'three', tomorrow).expect(201);
      const id = (created.body as Envelope<WithId>).data.id;
      const first = await call('STAFF', 'post', `registrations/${id}/cancel`).send({}).expect(201);
      expect((first.body as Envelope<{ status: string }>).data.status).toBe('CANCELLED');
      const again = await call('STAFF', 'post', `registrations/${id}/cancel`).send({}).expect(201);
      expect((again.body as Envelope<{ status: string }>).data.status).toBe('CANCELLED');
      const missing = await call('STAFF', 'post', 'registrations/does-not-exist/cancel')
        .send({})
        .expect(404);
      expect(missing.body).toMatchObject({ error: { code: 'REGISTRATION_NOT_FOUND' } });
      const paid = await call('STAFF', 'post', `registrations/${registrationId}/cancel`)
        .send({})
        .expect(409);
      expect(paid.body).toMatchObject({ error: { code: 'REGISTRATION_NOT_DRAFT' } });
      const confirm = await pay(id, 'cancelled-order-key').expect(409);
      expect(confirm.body).toMatchObject({ error: { code: 'REGISTRATION_NOT_DRAFT' } });
    });

    it('recovers a lost draft response with Idempotency-Key and rejects key reuse for another body', async () => {
      const first = await draft('D', 'three', tomorrow, 1, 'draft-key-1').expect(201);
      const replay = await draft('D', 'three', tomorrow, 1, 'draft-key-1').expect(201);
      const id = (first.body as Envelope<WithId>).data.id;
      expect((replay.body as Envelope<WithId>).data.id).toBe(id);
      expect(
        await db.registrationOrder.count({ where: { createIdempotencyKey: 'draft-key-1' } }),
      ).toBe(1);
      const conflict = await draft('D', 'three', tomorrow, 2, 'draft-key-1').expect(409);
      expect(conflict.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
      const mine = await call('STAFF', 'get', 'registrations')
        .query({ status: 'DRAFT', createdBy: 'me' })
        .expect(200);
      const page = (mine.body as Envelope<{ items: WithId[]; total: number }>).data;
      expect(page.items.map((item) => item.id)).toContain(id);
      await call('MANAGER', 'get', 'registrations').query({ createdBy: 'me' }).expect(200);
      await call('STAFF', 'post', `registrations/${id}/cancel`).send({}).expect(201);
    });

    it('binds the confirm key to actor and body, and refuses a new key for a finished order', async () => {
      const created = await draft('A', 'one', tomorrow).expect(201);
      const id = (created.body as Envelope<WithId>).data.id;
      const first = await pay(id, 'bound-key', { receiptNumber: 'BOUND-1' }).expect(201);
      const replay = await pay(id, 'bound-key', { receiptNumber: 'BOUND-1' }).expect(201);
      expect(replay.body).toEqual(first.body);
      const otherBody = await pay(id, 'bound-key', { receiptNumber: 'BOUND-2' }).expect(409);
      expect(otherBody.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_CONFLICT' } });
      const newKey = await pay(id, 'second-key', { receiptNumber: 'BOUND-1' }).expect(409);
      expect(newKey.body).toMatchObject({ error: { code: 'REGISTRATION_NOT_DRAFT' } });
      expect(await db.payment.count({ where: { registrationOrderId: id } })).toBe(1);
    });

    it('counts seats by peak occupancy, so back-to-back packages do not block each other', async () => {
      // class "one" has one seat and kid A holds [tomorrow, +1 month)
      const overlap = await draft('B', 'one', tomorrow).expect(409);
      expect(overlap.body).toMatchObject({ error: { code: 'CLASS_FULL' } });
      const later = await draft('B', 'one', dayAfter(35)).expect(201);
      await pay((later.body as Envelope<WithId>).data.id, 'later-key').expect(201);
      // class "two" has two seats: two sequential packages plus one long package never exceed one seat at a time
      for (const [kid, start] of [
        ['A', tomorrow],
        ['B', dayAfter(35)],
      ] as const) {
        const row = await draft(kid, 'two', start).expect(201);
        await pay((row.body as Envelope<WithId>).data.id, `two-${kid}`).expect(201);
      }
      const longTerm = await draft('C', 'two', tomorrow, 3).expect(201);
      await pay((longTerm.body as Envelope<WithId>).data.id, 'two-C').expect(201);
      const third = await draft('D', 'two', dayAfter(7)).expect(409);
      expect(third.body).toMatchObject({ error: { code: 'CLASS_FULL' } });
    });

    it('reports available seats and eligibility for the requested term', async () => {
      const full = await call('STAFF', 'get', 'classes')
        .query({ studentId: kids.D, startDate: tomorrow, packageMonths: 1, subject: 'Toán' })
        .expect(200);
      type Row = WithId & {
        name: string;
        availableSeats: number;
        isEligible: boolean;
        ineligibleReason: string | null;
      };
      const rows = (full.body as Envelope<Row[]>).data;
      const one = rows.find((row) => row.id === classes.one);
      expect(one).toMatchObject({
        availableSeats: 0,
        isEligible: false,
        ineligibleReason: 'CLASS_FULL',
      });
      const free = await call('STAFF', 'get', 'classes')
        .query({ studentId: kids.D, startDate: dayAfter(70), packageMonths: 1 })
        .expect(200);
      expect(
        (free.body as Envelope<Row[]>).data.find((row) => row.id === classes.one),
      ).toMatchObject({ availableSeats: 1, isEligible: true, ineligibleReason: null });
      await call('STAFF', 'get', 'classes').query({ startDate: tomorrow }).expect(400);
    });

    it('refuses to pay a draft whose start date has passed', async () => {
      const created = await draft('D', 'three', tomorrow, 1, 'stale-draft').expect(201);
      const id = (created.body as Envelope<WithId>).data.id;
      const yesterday = new Date(Date.now() + 7 * 3_600_000 - 86_400_000)
        .toISOString()
        .slice(0, 10);
      await db.registrationOrder.update({
        where: { id },
        data: { startDate: new Date(`${yesterday}T00:00:00Z`) },
      });
      const stale = await pay(id, 'stale-pay').expect(409);
      expect(stale.body).toMatchObject({ error: { code: 'INVALID_START_DATE' } });
      expect(await db.payment.count({ where: { registrationOrderId: id } })).toBe(0);
      await call('STAFF', 'post', `registrations/${id}/cancel`).send({}).expect(201);
    });

    it('derives the receipt term status from the end date and enrollment status', async () => {
      const order = await db.registrationOrder.findFirstOrThrow({
        where: { targetStudentId: kids.A, classId: classes.one },
      });
      const status = async (): Promise<{ status: string; label: string }> =>
        (
          (await call('STAFF', 'get', `registrations/${order.id}/receipt`).expect(200))
            .body as Envelope<{
            term: { status: string; label: string };
          }>
        ).data.term;
      expect(await status()).toMatchObject({ status: 'UPCOMING', label: 'Sắp học' });
      const yesterday = new Date(Date.now() + 7 * 3_600_000 - 86_400_000)
        .toISOString()
        .slice(0, 10);
      await db.enrollment.update({
        where: { registrationOrderId: order.id },
        data: { endDate: new Date(`${yesterday}T00:00:00Z`) },
      });
      expect(await status()).toMatchObject({ status: 'EXPIRED', label: 'Đã hết hạn' });
    });

    it('lets staff read students, enrollments, schedules, classes and payments', async () => {
      const students = await call('STAFF', 'get', 'students').query({ search: 'Kid' }).expect(200);
      const page = (students.body as Envelope<{ items: WithId[]; total: number }>).data;
      expect(page.total).toBe(4);
      const enrollments = await call('STAFF', 'get', `students/${kids.B}/enrollments`).expect(200);
      expect((enrollments.body as Envelope<WithId[]>).data.length).toBeGreaterThan(0);
      const schedule = await call('STAFF', 'get', `students/${kids.C}/schedule`).expect(200);
      expect((schedule.body as Envelope<WithId[]>).data.length).toBeGreaterThan(0);
      await call('PARENT', 'get', 'students').expect(403);
      await call('TEACHER', 'get', `students/${kids.A}/schedule`).expect(403);
      const detail = await call('STAFF', 'get', `classes/${classes.two}`).expect(200);
      expect(
        (detail.body as Envelope<{ weeklySchedules: unknown[]; enrollments: { total: number } }>)
          .data,
      ).toMatchObject({ enrollments: { total: 3 } });
      await call('STAFF', 'get', 'classes/does-not-exist').expect(404);
      const payments = await call('STAFF', 'get', 'payments').expect(200);
      const ledger = (payments.body as Envelope<{ total: number; totalAmount: string }>).data;
      expect(ledger.total).toBeGreaterThanOrEqual(6);
      expect(Number(ledger.totalAmount)).toBeGreaterThan(0);
      await call('MANAGER', 'get', 'payments').expect(200);
      await call('TEACHER', 'get', 'payments').expect(403);
    });

    it('edits and deletes programs only while they are unused', async () => {
      const fresh = await call('MANAGER', 'post', 'programs')
        .send({ name: 'Lý 7', subject: 'Lý', grade: 7 })
        .expect(201);
      const id = (fresh.body as Envelope<WithId>).data.id;
      await call('MANAGER', 'patch', `programs/${id}`)
        .send({ name: 'Vật lý 7', grade: 8 })
        .expect(200);
      await call('STAFF', 'patch', `programs/${id}`).send({ name: 'x' }).expect(403);
      const used = await call('MANAGER', 'patch', `programs/${programId}`)
        .send({ grade: 9 })
        .expect(409);
      expect(used.body).toMatchObject({ error: { code: 'PROGRAM_IN_USE' } });
      await call('MANAGER', 'patch', `programs/${programId}`)
        .send({ name: 'Toán 8 nâng cao' })
        .expect(200);
      const blocked = await call('MANAGER', 'delete', `programs/${programId}`).expect(409);
      expect(blocked.body).toMatchObject({ error: { code: 'PROGRAM_IN_USE' } });
      await call('MANAGER', 'delete', `programs/${id}`).expect(200);
    });
  });

  describe('manager directory and dashboard', () => {
    type Account = WithId & { email: string; status: string; role: string };

    it('creates, lists, renames and disables staff and teachers without exposing secrets', async () => {
      for (const [role, path] of [
        ['STAFF', 'staff'],
        ['TEACHER', 'teachers'],
      ] as const) {
        const email = `new${path}@example.com`;
        const created = await call('MANAGER', 'post', path)
          .send({
            email: ` NEW${path.toUpperCase()}@example.com `,
            password: 'InitialPass123!',
            displayName: ' Nguyễn Mới ',
          })
          .expect(201);
        const account = (created.body as Envelope<Account>).data;
        expect(account).toMatchObject({ email, role, status: 'ACTIVE' });
        expect(JSON.stringify(created.body)).not.toMatch(/passwordHash|InitialPass123/);
        await call('MANAGER', 'post', path)
          .send({ email, password: 'InitialPass123!', displayName: 'Dup' })
          .expect(409);
        // /auth/login allows 5 calls per minute, which beforeAll already uses, so check the stored credential.
        const stored = await db.user.findUniqueOrThrow({ where: { id: account.id } });
        expect(await bcrypt.compare('InitialPass123!', stored.passwordHash ?? '')).toBe(true);
        expect(stored.emailVerifiedAt).not.toBeNull();
        const list = await call('MANAGER', 'get', path)
          .query({ status: 'ACTIVE', search: 'new' })
          .expect(200);
        expect(
          (list.body as Envelope<{ items: Account[] }>).data.items.map((row) => row.id),
        ).toContain(account.id);
        const renamed = await call('MANAGER', 'patch', `${path}/${account.id}`)
          .send({ displayName: 'Tên Mới' })
          .expect(200);
        expect((renamed.body as Envelope<{ displayName: string }>).data.displayName).toBe(
          'Tên Mới',
        );
        await call('MANAGER', 'patch', `${path}/${account.id}`)
          .send({ status: 'DISABLED' })
          .expect(200);
        expect((await db.user.findUniqueOrThrow({ where: { id: account.id } })).status).toBe(
          'DISABLED',
        );
        const disabled = await call('MANAGER', 'get', path)
          .query({ status: 'DISABLED' })
          .expect(200);
        expect(
          (disabled.body as Envelope<{ items: Account[] }>).data.items.map((row) => row.id),
        ).toContain(account.id);
      }
      // Other roles' accounts are invisible through these endpoints.
      const managerId = (await db.user.findFirstOrThrow({ where: { role: 'MANAGER' } })).id;
      await call('MANAGER', 'get', `staff/${managerId}`).expect(404);
      await call('MANAGER', 'patch', `teachers/${managerId}`)
        .send({ status: 'DISABLED' })
        .expect(404);
    });

    it('enforces roles: staff may only read teachers; everyone else is forbidden', async () => {
      await call('STAFF', 'get', 'teachers').query({ status: 'ACTIVE' }).expect(200);
      await call('STAFF', 'post', 'teachers')
        .send({ email: 'x@example.com', password: 'InitialPass123!', displayName: 'X' })
        .expect(403);
      await call('STAFF', 'get', 'staff').expect(403);
      for (const role of ['TEACHER', 'CURRICULUM_DESIGNER', 'PARENT'] as UserRole[]) {
        await call(role, 'get', 'teachers').expect(403);
        await call(role, 'post', 'staff')
          .send({ email: 'y@example.com', password: 'InitialPass123!', displayName: 'Y' })
          .expect(403);
        await call(role, 'get', 'parents').expect(403);
        await call(role, 'get', 'dashboard').expect(403);
      }
      await call('STAFF', 'get', 'parents').expect(403);
      await call('STAFF', 'get', 'dashboard').expect(403);
      await call('MANAGER', 'post', 'staff')
        .send({ email: 'bad', password: 'short', displayName: '' })
        .expect(400);
    });

    it('lets the manager manage parents but never their email or password', async () => {
      const list = await call('MANAGER', 'get', 'parents')
        .query({ search: 'parentmain' })
        .expect(200);
      const parent = (list.body as Envelope<{ items: Account[] }>).data.items[0];
      expect(parent.email).toBe('parentmain@example.com');
      const detail = await call('MANAGER', 'get', `parents/${parent.id}`).expect(200);
      expect(
        (detail.body as Envelope<{ parentProfile: { students: unknown[] } }>).data.parentProfile
          .students.length,
      ).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(detail.body)).not.toMatch(/passwordHash/);
      const updated = await call('MANAGER', 'patch', `parents/${parent.id}`)
        .send({ displayName: 'Phụ huynh A', phone: '0901234567' })
        .expect(200);
      expect(
        (updated.body as Envelope<{ displayName: string; parentProfile: { phone: string } }>).data,
      ).toMatchObject({ displayName: 'Phụ huynh A', parentProfile: { phone: '0901234567' } });
      await call('MANAGER', 'patch', `parents/${parent.id}`)
        .send({ email: 'hijack@example.com' })
        .expect(400);
      await call('MANAGER', 'get', 'parents/missing').expect(404);
      // static routes still win over parents/:id
      await call('STAFF', 'get', 'parents/search').query({ email: 'parentmain' }).expect(200);
      await call('STAFF', 'get', 'parents/lookup')
        .query({ email: 'parentmain@example.com' })
        .expect(200);
    });

    it('reports confirmed tuition and active counts for a date range, not drafts', async () => {
      const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
      const confirmed = await db.payment.aggregate({ _sum: { amount: true }, _count: true });
      const dashboard = await call('MANAGER', 'get', 'dashboard')
        .query({ fromDate: today, toDate: today })
        .expect(200);
      const data = (
        dashboard.body as Envelope<{
          tuition: { confirmedAmount: string; paymentCount: number };
          counts: Record<string, number>;
          registrations: Record<string, number>;
        }>
      ).data;
      expect(data.tuition.paymentCount).toBe(confirmed._count);
      expect(Number(data.tuition.confirmedAmount)).toBe(Number(confirmed._sum.amount));
      expect(data.counts.activeTeachers).toBe(
        await db.user.count({ where: { role: 'TEACHER', status: 'ACTIVE' } }),
      );
      expect(data.counts.activeStaff).toBe(
        await db.user.count({ where: { role: 'STAFF', status: 'ACTIVE' } }),
      );
      expect(data.registrations.completed).toBe(
        await db.registrationOrder.count({ where: { status: 'COMPLETED' } }),
      );
      const empty = await call('MANAGER', 'get', 'dashboard')
        .query({ fromDate: '2020-01-01', toDate: '2020-01-31' })
        .expect(200);
      expect(
        (empty.body as Envelope<{ tuition: { confirmedAmount: string; paymentCount: number } }>)
          .data.tuition,
      ).toMatchObject({ confirmedAmount: '0', paymentCount: 0 });
      await call('MANAGER', 'get', 'dashboard')
        .query({ fromDate: '2026-02-01', toDate: '2026-01-01' })
        .expect(400);
    });
  });

  describe('staff academic permissions', () => {
    it('grants staff the read and workflow endpoints from the staff role while keeping teachers out', async () => {
      for (const path of [
        'academic/enrollments',
        'academic/leaves',
        'academic/makeups',
        'academic/makeup-sources',
        'academic/sessions',
        'academic/classes',
        'academic/programs',
      ]) {
        await call('STAFF', 'get', path).expect(200);
      }
      await call('STAFF', 'get', 'academic/leaves')
        .query({ status: 'PENDING', fromDate: '2026-01-01', toDate: '2026-12-31' })
        .expect(200);
      await call('STAFF', 'get', 'academic/leaves').query({ status: 'BOGUS' }).expect(400);
      await call('TEACHER', 'get', 'academic/leaves').expect(403);
      await call('PARENT', 'get', 'academic/makeup-sources').expect(403);
    });

    it('lets staff record a long-term pause that is approved immediately, and ends study with an audited impact', async () => {
      const enrollment = await db.enrollment.findFirstOrThrow({
        where: { studentProfileId: studentId, status: 'ACTIVE' },
      });
      const from = new Date(Date.now() + 7 * 3_600_000 + 5 * 86_400_000).toISOString().slice(0, 10);
      const leave = await call('STAFF', 'post', 'academic/leaves')
        .send({
          enrollmentId: enrollment.id,
          kind: 'PERIOD_PAUSE',
          fromDate: from,
          toDate: from,
          reason: 'Gia đình đi xa',
        })
        .expect(201);
      expect((leave.body as Envelope<{ status: string; decidedById: string }>).data).toMatchObject({
        status: 'APPROVED',
        decidedById: staffId,
      });
      const ended = await call('STAFF', 'post', `academic/students/${studentId}/end-study`).expect(
        201,
      );
      expect(
        (ended.body as Envelope<{ status: string; impact: { enrollmentIds: string[] } }>).data,
      ).toMatchObject({ status: 'INACTIVE', impact: { enrollmentIds: [enrollment.id] } });
      expect(
        await db.auditLog.count({ where: { action: 'STUDENT_END_STUDY', actorUserId: staffId } }),
      ).toBe(1);
      await call('TEACHER', 'post', `academic/students/${studentId}/end-study`).expect(403);
    });
  });
});
