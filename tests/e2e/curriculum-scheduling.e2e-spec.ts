import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import * as mysql from 'mysql2/promise';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../src/app.module';
import { validateEnvironment } from '../../src/config/configuration';
import { DatabaseService } from '../../src/database/orm/database.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { GradingWorkerService } from '../../src/modules/academic/grading-worker.service';

const DB_NAME = 'edugrade_schedule_test';
const DB_SERVER = new URL(
  process.env.ACADEMIC_TEST_DATABASE_URL ?? 'mysql://root:admin123@localhost:3306',
);
const DB_URL = `mysql://${DB_SERVER.username}:${DB_SERVER.password}@${DB_SERVER.host}/${DB_NAME}`;
type Envelope<T> = { data: T; error?: { code: string } };
type Id = { id: string };

describe('Shared curriculum and generated sessions', () => {
  let app: INestApplication;
  let server: Server;
  let db: DatabaseService;
  let databaseCreated = false;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const call = (role: string, method: 'get' | 'post' | 'patch', route: string): request.Test =>
    request(server)
      [method](`/api/v1/academic/${route}`)
      .set('Authorization', `Bearer ${tokens[role]}`);

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: DB_URL,
      CORS_ORIGINS: 'http://localhost:3000',
      SWAGGER_ENABLED: 'false',
      JWT_ACCESS_SECRET: 'schedule-test-access-secret-at-least-32-characters',
      JWT_REFRESH_SECRET: 'schedule-test-refresh-secret-at-least-32-characters',
    });
    const connection = await mysql.createConnection({
      host: DB_SERVER.hostname,
      port: Number(DB_SERVER.port || 3306),
      user: decodeURIComponent(DB_SERVER.username),
      password: decodeURIComponent(DB_SERVER.password),
    });
    await connection.query('DROP DATABASE IF EXISTS ??', [DB_NAME]);
    await connection.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [
      DB_NAME,
    ]);
    databaseCreated = true;
    await connection.end();
    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      { env: process.env, stdio: 'pipe' },
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
    server = app.getHttpServer() as Server;
    db = app.get(DatabaseService);
    await app.get(GradingWorkerService).onModuleDestroy();

    const password = 'ScheduleTest123!';
    const passwordHash = await bcrypt.hash(password, 4);
    for (const role of ['MANAGER', 'CURRICULUM_DESIGNER', 'TEACHER', 'PARENT'] as const) {
      const user = await db.user.create({
        data: { email: `${role.toLowerCase()}@schedule.test`, passwordHash, role },
      });
      ids[role] = user.id;
      tokens[role] = (await app.get(AuthService).login(user.email, password)).tokens.accessToken;
    }
    const programA = await db.program.create({
      data: { name: 'Toán 8 A', grade: 8, subject: 'Toán' },
    });
    const programB = await db.program.create({
      data: { name: 'Toán 8 B', grade: 8, subject: ' Toán ' },
    });
    ids.programA = programA.id;
    ids.programB = programB.id;
    for (const [name, programId, weekdays] of [
      ['A', programA.id, [1, 3, 5]],
      ['B', programB.id, [2, 4, 6]],
      ['C', programA.id, [1]],
    ] as const) {
      const classroom = await db.class.create({
        data: {
          name,
          programId,
          teacherId: ids.TEACHER,
          capacity: 20,
          monthlyFee: 500000,
          isOpen: true,
        },
      });
      ids[name] = classroom.id;
      await db.classWeeklySchedule.createMany({
        data: weekdays.map((weekday) => ({
          classId: classroom.id,
          weekday,
          startTime: '18:00',
          endTime: '20:00',
        })),
      });
    }
    const parent = await db.parentProfile.create({ data: { userId: ids.PARENT } });
    const student = await db.studentProfile.create({
      data: { parentProfileId: parent.id, fullName: 'An', grade: 8 },
    });
    const order = await db.registrationOrder.create({
      data: {
        type: 'FIRST_CHILD',
        parentEmail: 'parent@schedule.test',
        studentFullName: 'An',
        studentGrade: 8,
        classId: ids.A,
        targetStudentId: student.id,
        packageMonths: 1,
        quotedAmount: 500000,
        createdByManagerId: ids.MANAGER,
        status: 'COMPLETED',
      },
    });
    await db.enrollment.create({
      data: {
        registrationOrderId: order.id,
        studentProfileId: student.id,
        classId: ids.A,
        packageMonths: 1,
        status: 'ACTIVE',
        startDate: new Date('2027-01-04T00:00:00Z'),
        endDate: new Date('2027-01-11T00:00:00Z'),
      },
    });
  }, 90_000);

  afterAll(async () => {
    if (app) await app.close();
    if (!databaseCreated) return;
    const connection = await mysql.createConnection({
      host: DB_SERVER.hostname,
      port: Number(DB_SERVER.port || 3306),
      user: decodeURIComponent(DB_SERVER.username),
      password: decodeURIComponent(DB_SERVER.password),
    });
    await connection.query('DROP DATABASE IF EXISTS ??', [DB_NAME]);
    await connection.end();
  });

  it('requires enough approved lessons, enforces roles and generates shared content safely', async () => {
    const definition = {
      programId: ids.programA,
      title: 'Học phần tháng 1',
      fromDate: '2027-01-04',
      toDate: '2027-01-10',
    };
    await call('PARENT', 'post', 'curriculum-units').send(definition).expect(403);
    const created = await call('CURRICULUM_DESIGNER', 'post', 'curriculum-units')
      .send(definition)
      .expect(201);
    const unitId = (created.body as Envelope<Id>).data.id;
    const lesson = await call('CURRICULUM_DESIGNER', 'post', `curriculum-units/${unitId}/lessons`)
      .send({ title: 'Bài 1', content: 'Nội dung 1', sequence: 1 })
      .expect(201);
    const lesson1 = (lesson.body as Envelope<Id>).data.id;
    const missing = await call('MANAGER', 'post', `curriculum-units/${unitId}/approve`)
      .send({})
      .expect(409);
    expect((missing.body as Envelope<never>).error?.code).toBe('INSUFFICIENT_LESSONS');
    const lesson2 = await call('CURRICULUM_DESIGNER', 'post', `curriculum-units/${unitId}/lessons`)
      .send({ title: 'Bài 2', content: 'Nội dung 2', sequence: 2 })
      .expect(201);
    const missingTest = await call('MANAGER', 'post', `curriculum-units/${unitId}/approve`)
      .send({})
      .expect(409);
    expect((missingTest.body as Envelope<never>).error?.code).toBe('MISSING_MONTHLY_TEST');
    const test = await call(
      'CURRICULUM_DESIGNER',
      'post',
      `curriculum-units/${unitId}/monthly-tests`,
    )
      .send({ monthKey: '2027-01', title: 'Kiểm tra tháng 1', content: 'Đề kiểm tra' })
      .expect(201);
    await call('CURRICULUM_DESIGNER', 'post', `curriculum-units/${unitId}/approve`)
      .send({})
      .expect(403);
    await call('MANAGER', 'post', `curriculum-units/${unitId}/approve`).send({}).expect(201);
    await call('CURRICULUM_DESIGNER', 'patch', `curriculum-units/${unitId}/lessons/${lesson1}`)
      .send({ title: 'Sửa', content: 'Sửa', sequence: 1 })
      .expect(409);

    const body = { curriculumUnitId: unitId, fromDate: '2027-01-04', toDate: '2027-01-10' };
    const preview = await call('MANAGER', 'post', `classes/${ids.A}/session-preview`)
      .send(body)
      .expect(201);
    const previewSlots = (
      preview.body as Envelope<{ slots: Array<{ lessonId: string; kind: string }> }>
    ).data.slots;
    expect(previewSlots.map((slot) => slot.lessonId)).toEqual([
      lesson1,
      (lesson2.body as Envelope<Id>).data.id,
      (test.body as Envelope<Id>).data.id,
    ]);
    expect(previewSlots[2].kind).toBe('MONTHLY_TEST');

    const [first, concurrent] = await Promise.all([
      call('MANAGER', 'post', `classes/${ids.A}/session-generations`)
        .set('Idempotency-Key', 'generation-A')
        .send(body),
      call('MANAGER', 'post', `classes/${ids.A}/session-generations`)
        .set('Idempotency-Key', 'generation-other')
        .send(body),
    ]);
    expect([first.status, concurrent.status].sort()).toEqual([201, 409]);
    const successful = first.status === 201 ? first : concurrent;
    const key = first.status === 201 ? 'generation-A' : 'generation-other';
    const generated = (successful.body as Envelope<{ id: string; sessions: Array<{ id: string }> }>)
      .data;
    expect(generated.sessions).toHaveLength(3);
    const repeated = await call('MANAGER', 'post', `classes/${ids.A}/session-generations`)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect((repeated.body as Envelope<{ id: string }>).data.id).toBe(generated.id);
    const changed = await call('MANAGER', 'post', `classes/${ids.A}/session-generations`)
      .set('Idempotency-Key', key)
      .send({ ...body, toDate: '2027-01-09' })
      .expect(409);
    expect((changed.body as Envelope<never>).error?.code).toBe('IDEMPOTENCY_CONFLICT');

    const b = await call('MANAGER', 'post', `classes/${ids.B}/session-generations`)
      .set('Idempotency-Key', 'generation-B')
      .send(body)
      .expect(201);
    const bSessions = (b.body as Envelope<{ sessions: Array<{ lessonId: string }> }>).data.sessions;
    expect(bSessions.map((item) => item.lessonId)).toEqual(
      previewSlots.map((item) => item.lessonId),
    );
    const aPreview = await call('MANAGER', 'post', `classes/${ids.A}/session-preview`)
      .send(body)
      .expect(201);
    const aPreviewSlots = (
      aPreview.body as Envelope<{ slots: Array<{ makeupCandidates: unknown[] }> }>
    ).data.slots;
    expect(aPreviewSlots[0].makeupCandidates).toHaveLength(1);
    const scheduleChange = await request(server)
      .post(`/api/v1/classes/${ids.B}/schedules`)
      .set('Authorization', `Bearer ${tokens.MANAGER}`)
      .send({ schedules: [{ weekday: 2, startTime: '17:00', endTime: '19:00' }] })
      .expect(409);
    expect((scheduleChange.body as Envelope<never>).error?.code).toBe('CLASS_SCHEDULE_LOCKED');
    const conflict = await call('MANAGER', 'post', `classes/${ids.C}/session-generations`)
      .set('Idempotency-Key', 'generation-C')
      .send(body)
      .expect(409);
    expect((conflict.body as Envelope<never>).error?.code).toBe('SCHEDULE_CONFLICT');

    const parentSessions = await call(
      'PARENT',
      'get',
      `scheduled-sessions?classId=${ids.A}&fromDate=2027-01-04&toDate=2027-01-10`,
    ).expect(200);
    expect(
      (parentSessions.body as Envelope<Array<{ lesson: { kind: string } }>>).data,
    ).toHaveLength(3);
    const otherClass = await call(
      'PARENT',
      'get',
      `scheduled-sessions?classId=${ids.B}&fromDate=2027-01-04&toDate=2027-01-10`,
    ).expect(200);
    expect((otherClass.body as Envelope<unknown[]>).data).toHaveLength(0);
    const revision = await call(
      'CURRICULUM_DESIGNER',
      'post',
      `curriculum-units/${unitId}/revisions`,
    )
      .send({})
      .expect(201);
    expect((revision.body as Envelope<{ status: string; version: number }>).data).toMatchObject({
      status: 'DRAFT',
      version: 2,
    });
  }, 90_000);
});
