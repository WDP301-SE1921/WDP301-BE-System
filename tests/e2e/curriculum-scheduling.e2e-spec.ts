import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import * as mysql from 'mysql2/promise';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import type { Class, Program } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { validateEnvironment } from '../../src/config/configuration';
import { DatabaseService } from '../../src/database/orm/database.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { GradingWorkerService } from '../../src/modules/academic/grading-worker.service';
import { CurriculumLifecycleWorker } from '../../src/modules/curriculum-scheduling/curriculum-lifecycle.worker';

const DB_NAME = `edugrade_schedule_test_${process.pid}_${Date.now().toString(36)}`;
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

  const prepareUnit = async (
    programId: string,
    title: string,
    fromDate: string,
    toDate: string,
  ): Promise<{ id: string; fromDate: string; toDate: string }> => {
    const created = await call('CURRICULUM_DESIGNER', 'post', 'curriculum-units')
      .send({ programId, title, fromDate, toDate })
      .expect(201);
    const id = (created.body as Envelope<Id>).data.id;
    await call('CURRICULUM_DESIGNER', 'post', `curriculum-units/${id}/lessons`)
      .send({ title: `${title} - Bài 1`, content: 'Nội dung', sequence: 1 })
      .expect(201);
    const submitted = await call('CURRICULUM_DESIGNER', 'post', `curriculum-units/${id}/submit`)
      .send({ reviewerTeacherId: ids.TEACHER })
      .expect(201);
    await call('TEACHER', 'post', `curriculum-units/${id}/technical-review`)
      .send({
        approved: true,
        expectedRevision: (submitted.body as Envelope<{ revision: number }>).data.revision,
      })
      .expect(201);
    return { id, fromDate, toDate };
  };

  const programWithReviewer = async (
    name: string,
  ): Promise<{ program: Program; classroom: Class }> => {
    const program = await db.program.create({
      data: { name, grade: 8, subject: 'Toán', sessionsPerWeek: 1 },
    });
    const classroom = await db.class.create({
      data: {
        name: `${name} - Lớp`,
        programId: program.id,
        teacherId: ids.TEACHER,
        capacity: 20,
        monthlyFee: 500000,
        isOpen: false,
      },
    });
    return { program, classroom };
  };

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
      data: { name: 'Toán 8 A', grade: 8, subject: 'Toán', sessionsPerWeek: 3 },
    });
    const programB = await db.program.create({
      data: { name: 'Toán 8 B', grade: 8, subject: ' Toán ', sessionsPerWeek: 3 },
    });
    ids.programA = programA.id;
    ids.programB = programB.id;
    for (const [name, programId, weekdays] of [
      ['A', programA.id, [1, 3, 5]],
      ['B', programA.id, [2, 4, 6]],
      ['C', programA.id, [1, 3, 5]],
      ['D', programB.id, [2, 4, 6]],
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
    ids.student = student.id;
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
    await call('CURRICULUM_DESIGNER', 'post', `curriculum-units/${unitId}/submit`)
      .send({ reviewerTeacherId: ids.TEACHER })
      .expect(201);
    await call('MANAGER', 'post', `curriculum-units/${unitId}/request-changes`)
      .send({ reason: 'Thêm bài học cho các buổi còn lại' })
      .expect(201);
    const lesson2 = await call('CURRICULUM_DESIGNER', 'post', `curriculum-units/${unitId}/lessons`)
      .send({ title: 'Bài 2', content: 'Nội dung 2', sequence: 2 })
      .expect(201);
    const removedTest = await call(
      'CURRICULUM_DESIGNER',
      'post',
      `curriculum-units/${unitId}/monthly-tests`,
    )
      .send({ monthKey: '2027-01', title: 'Kiểm tra tháng 1', content: 'Đề kiểm tra' })
      .expect(409);
    expect(removedTest.body).toMatchObject({ error: { code: 'TESTS_MANAGED_BY_TEACHER' } });
    const lesson3 = await call('CURRICULUM_DESIGNER', 'post', `curriculum-units/${unitId}/lessons`)
      .send({ title: 'Bài 3', content: 'Nội dung 3', sequence: 3 })
      .expect(201);
    await call('CURRICULUM_DESIGNER', 'post', `curriculum-units/${unitId}/approve`)
      .send({})
      .expect(403);
    const submitted = await call('CURRICULUM_DESIGNER', 'post', `curriculum-units/${unitId}/submit`)
      .send({ reviewerTeacherId: ids.TEACHER })
      .expect(201);
    await call('MANAGER', 'post', `curriculum-units/${unitId}/approve`).send({}).expect(409);
    await call('TEACHER', 'get', `curriculum-units?status=PENDING_REVIEW`).expect(200);
    await call('TEACHER', 'post', `curriculum-units/${unitId}/technical-review`)
      .send({
        approved: true,
        note: 'Nội dung phù hợp với học sinh khối 8.',
        expectedRevision: (submitted.body as Envelope<{ revision: number }>).data.revision,
      })
      .expect(201);
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
      (lesson3.body as Envelope<Id>).data.id,
    ]);
    expect(previewSlots[2].kind).toBe('LESSON');

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
    const otherProgram = await call('MANAGER', 'post', `classes/${ids.D}/session-preview`)
      .send(body)
      .expect(409);
    expect((otherProgram.body as Envelope<never>).error?.code).toBe('CURRICULUM_MISMATCH');
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
      .send({ title: 'Học phần tháng 2', fromDate: '2027-02-01', toDate: '2027-02-28' })
      .expect(201);
    expect((revision.body as Envelope<{ status: string; version: number }>).data).toMatchObject({
      status: 'DRAFT',
      version: 1,
    });
    const sessionId = generated.sessions[0].id;
    await call('TEACHER', 'post', `sessions/${sessionId}/roster`).send({}).expect(201);
    await call('PARENT', 'get', `scheduled-sessions/${sessionId}?studentId=${ids.student}`).expect(
      200,
    );
    await call('PARENT', 'get', `scheduled-sessions/${sessionId}?studentId=someone-else`).expect(
      403,
    );
    const move = {
      startsAt: '2027-01-04T10:00:00.000Z',
      endsAt: '2027-01-04T11:00:00.000Z',
      reason: 'Đổi giờ học',
      expectedRevision: 1,
    };
    await call('MANAGER', 'post', `sessions/${sessionId}/reschedule-preview`)
      .send(move)
      .expect(201);
    const moved = await call('MANAGER', 'post', `sessions/${sessionId}/reschedule`)
      .set('Idempotency-Key', 'move-first-session')
      .send(move)
      .expect(201);
    expect((moved.body as Envelope<{ revision: number }>).data.revision).toBe(2);
    await call('MANAGER', 'post', `sessions/${sessionId}/reschedule`)
      .set('Idempotency-Key', 'move-first-session')
      .send(move)
      .expect(201);
    const cancelled = await call('MANAGER', 'post', `sessions/${sessionId}/cancel`)
      .set('Idempotency-Key', 'cancel-first-session')
      .send({ reason: 'Nghỉ học', expectedRevision: 2 })
      .expect(201);
    expect((cancelled.body as Envelope<{ status: string }>).data.status).toBe('CANCELLED');
  }, 90_000);

  it('previews and atomically imports a CSV draft, then allows deleting the unused draft', async () => {
    const created = await call('CURRICULUM_DESIGNER', 'post', 'curriculum-units')
      .send({
        programId: ids.programB,
        title: 'Học phần tháng 2',
        fromDate: '2027-02-01',
        toDate: '2027-02-28',
      })
      .expect(201);
    const id = (created.body as Envelope<Id>).data.id;
    const csv = Buffer.from(
      'kind,sequence,title,content,monthKey\nLESSON,1,Tập hợp,Nội dung 1,\nLESSON,2,Số tự nhiên,Nội dung 2,\n',
    );
    const preview = await call(
      'CURRICULUM_DESIGNER',
      'post',
      `curriculum-units/${id}/import-preview`,
    )
      .field('mode', 'REPLACE')
      .attach('file', csv, 'curriculum.csv')
      .expect(201);
    const data = (
      preview.body as Envelope<{
        previewId: string;
        expectedRevision: number;
        rows: Array<{
          rowNumber: number;
          kind: 'LESSON' | 'MONTHLY_TEST';
          sequence: number | null;
          title: string;
          content: string;
          monthKey: string | null;
        }>;
      }>
    ).data;
    const body = {
      previewId: data.previewId,
      expectedRevision: data.expectedRevision,
      mode: 'REPLACE',
      rows: data.rows.map(({ rowNumber, kind, sequence, title, content, monthKey }) => ({
        rowNumber,
        kind,
        sequence,
        title,
        content,
        monthKey,
      })),
    };
    const changedRows = await call(
      'CURRICULUM_DESIGNER',
      'post',
      `curriculum-units/${id}/import-commit`,
    )
      .set('Idempotency-Key', 'import-changed-rows')
      .send({
        ...body,
        rows: [{ ...body.rows[0], title: 'Changed after preview' }, ...body.rows.slice(1)],
      })
      .expect(409);
    expect(changedRows.body).toMatchObject({ error: { code: 'IMPORT_PREVIEW_STALE' } });
    const imported = await call(
      'CURRICULUM_DESIGNER',
      'post',
      `curriculum-units/${id}/import-commit`,
    )
      .set('Idempotency-Key', 'import-february')
      .send(body)
      .expect(201);
    expect(
      (imported.body as Envelope<{ lessonCount: number; testCount: number }>).data,
    ).toMatchObject({ lessonCount: 2, testCount: 0 });
    await call('CURRICULUM_DESIGNER', 'post', `curriculum-units/${id}/import-commit`)
      .set('Idempotency-Key', 'import-february')
      .send(body)
      .expect(201);
    await request(server)
      .delete(`/api/v1/academic/curriculum-units/${id}`)
      .set('Authorization', `Bearer ${tokens.CURRICULUM_DESIGNER}`)
      .expect(200);
  }, 90_000);

  it('serializes independent overlapping approvals by program and preserves archived history', async () => {
    const { program } = await programWithReviewer('Khóa kiểm tra hiệu lực');
    const first = await prepareUnit(program.id, 'Kỳ A', '2027-10-01', '2027-10-31');
    const second = await prepareUnit(program.id, 'Kỳ B', '2027-10-31', '2027-11-30');
    const responses = await Promise.all(
      [first, second].map((unit) =>
        call('MANAGER', 'post', `curriculum-units/${unit.id}/approve`).send({}),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const winner = responses[0].status === 201 ? first : second;
    const loser = responses[0].status === 409 ? first : second;
    expect(responses.find((response) => response.status === 409)?.body).toMatchObject({
      error: { code: 'CURRICULUM_EFFECTIVE_PERIOD_CONFLICT' },
    });
    expect(await db.curriculumUnit.findUnique({ where: { id: loser.id } })).toMatchObject({
      status: 'PENDING_REVIEW',
    });
    expect(await db.lesson.count({ where: { unitId: loser.id, status: 'APPROVED' } })).toBe(0);
    expect(
      await db.auditLog.count({
        where: { action: 'CURRICULUM_UNIT_APPROVED', entityId: loser.id },
      }),
    ).toBe(0);

    const successorStart = new Date(new Date(winner.toDate).getTime() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const successor = await prepareUnit(program.id, 'Kỳ tiếp nối', successorStart, '2027-12-31');
    await call('MANAGER', 'post', `curriculum-units/${successor.id}/approve`).send({}).expect(201);
    expect(await db.curriculumUnit.findUnique({ where: { id: winner.id } })).toMatchObject({
      status: 'APPROVED',
    });
    const { program: differentProgram } = await programWithReviewer('Khóa khác chung môn khối');
    const other = await prepareUnit(
      differentProgram.id,
      'Kỳ khóa khác',
      winner.fromDate,
      winner.toDate,
    );
    await call('MANAGER', 'post', `curriculum-units/${other.id}/approve`).send({}).expect(201);

    const worker = app.get(CurriculumLifecycleWorker);
    const transitionAt = new Date(new Date(successorStart).getTime() - 7 * 3_600_000);
    await worker.tick(new Date(transitionAt.getTime() - 1));
    expect(await db.curriculumUnit.findUnique({ where: { id: winner.id } })).toMatchObject({
      status: 'APPROVED',
    });
    await worker.tick(transitionAt);
    await worker.tick(transitionAt);
    expect(await db.curriculumUnit.findUnique({ where: { id: winner.id } })).toMatchObject({
      status: 'ARCHIVED',
      archiveReason: 'SUPERSEDED',
      supersededById: successor.id,
      fromDate: new Date(winner.fromDate),
      toDate: new Date(winner.toDate),
    });
    expect(
      await db.auditLog.count({
        where: { action: 'CURRICULUM_UNIT_AUTO_ARCHIVED', entityId: winner.id },
      }),
    ).toBe(1);
    const historicalStart = new Date(new Date(winner.fromDate).getTime() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const backdated = await prepareUnit(program.id, 'Bản hồi tố', historicalStart, winner.toDate);
    const rejected = await call('MANAGER', 'post', `curriculum-units/${backdated.id}/approve`)
      .send({})
      .expect(409);
    expect(rejected.body).toMatchObject({
      error: { code: 'CURRICULUM_EFFECTIVE_PERIOD_CONFLICT' },
    });
    await call('CURRICULUM_DESIGNER', 'post', `curriculum-units/${winner.id}/revisions`)
      .send({ title: 'Sao chép bản lưu trữ', fromDate: '2028-01-01', toDate: '2028-01-31' })
      .expect(201);
    const history = await call('TEACHER', 'get', `curriculum-units?programId=${program.id}`).expect(
      200,
    );
    expect((history.body as Envelope<Array<Id>>).data.map((unit) => unit.id)).toContain(winner.id);
    await call('TEACHER', 'get', `curriculum-units/${winner.id}`).expect(200);
  }, 90_000);

  it('retains a parent outline after late approval archives a past period, excluding manual removals', async () => {
    const { program, classroom } = await programWithReviewer('Khóa lịch sử phụ huynh');
    const localDay = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const day = (offset: number): string =>
      new Date(new Date(localDay).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const old = await prepareUnit(program.id, 'Kỳ đã học', day(-30), day(-1));
    await call('MANAGER', 'post', `curriculum-units/${old.id}/approve`).send({}).expect(201);
    const current = await prepareUnit(program.id, 'Kỳ hiện tại', day(0), day(30));
    await call('MANAGER', 'post', `curriculum-units/${current.id}/approve`).send({}).expect(201);
    expect(await db.curriculumUnit.findUnique({ where: { id: old.id } })).toMatchObject({
      status: 'ARCHIVED',
      archiveReason: 'SUPERSEDED',
    });
    const removed = await prepareUnit(program.id, 'Kỳ đã gỡ', day(31), day(35));
    await call('MANAGER', 'post', `curriculum-units/${removed.id}/approve`).send({}).expect(201);
    await request(server)
      .delete(`/api/v1/academic/curriculum-units/${removed.id}`)
      .set('Authorization', `Bearer ${tokens.MANAGER}`)
      .expect(200);
    const order = await db.registrationOrder.create({
      data: {
        type: 'FIRST_CHILD',
        parentEmail: 'parent@schedule.test',
        studentFullName: 'An',
        studentGrade: 8,
        classId: classroom.id,
        targetStudentId: ids.student,
        packageMonths: 2,
        quotedAmount: 1000000,
        createdByManagerId: ids.MANAGER,
        status: 'COMPLETED',
      },
    });
    await db.enrollment.create({
      data: {
        registrationOrderId: order.id,
        studentProfileId: ids.student,
        classId: classroom.id,
        packageMonths: 2,
        status: 'ACTIVE',
        startDate: new Date(day(-40)),
        endDate: new Date(day(40)),
      },
    });
    const outline = await call('PARENT', 'get', `me/students/${ids.student}/curriculum`).expect(
      200,
    );
    const unitIds = (outline.body as Envelope<{ items: Array<Id> }>).data.items.map(
      (unit) => unit.id,
    );
    expect(unitIds).toEqual(expect.arrayContaining([old.id, current.id]));
    expect(unitIds).not.toContain(removed.id);
    expect(await db.curriculumUnit.findUnique({ where: { id: removed.id } })).toMatchObject({
      archiveReason: 'MANUAL',
    });
  }, 90_000);
});
