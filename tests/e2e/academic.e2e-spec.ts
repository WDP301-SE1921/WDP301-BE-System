import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import * as mysql from 'mysql2/promise';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { validateEnvironment } from '../../src/config/configuration';
import { DatabaseService } from '../../src/database/orm/database.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { AcademicAiService } from '../../src/integrations/academic-ai.service';
import { GradingWorkerService } from '../../src/modules/academic/grading-worker.service';
import * as bcrypt from 'bcrypt';
import { Workbook } from 'exceljs';

const DB_NAME = 'edugrade_academic_test';
const DB_SERVER = new URL(
  process.env.ACADEMIC_TEST_DATABASE_URL ?? 'mysql://root:admin123@localhost:3306',
);
const DB_URL = `mysql://${DB_SERVER.username}:${DB_SERVER.password}@${DB_SERVER.host}/${DB_NAME}`;
type Envelope<T> = { data: T };
interface WithId {
  id: string;
}

describe('Academic workflows (database + HTTP)', () => {
  let app: INestApplication;
  let server: Server;
  let db: DatabaseService;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const ai = {
    available: (): boolean => true,
    json: jest.fn<Promise<unknown>, [string, unknown]>(),
  };
  const call = (role: string, method: 'post' | 'get', url: string): request.Test =>
    request(server)
      [method](`/api/v1/academic/${url}`)
      .set('Authorization', `Bearer ${tokens[role]}`);

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: DB_URL,
      CORS_ORIGINS: 'http://localhost:3000',
      SWAGGER_ENABLED: 'false',
      JWT_ACCESS_SECRET: 'academic-test-access-secret-at-least-32-characters',
      JWT_REFRESH_SECRET: 'academic-test-refresh-secret-at-least-32-characters',
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
    await connection.end();
    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      { env: process.env, stdio: 'pipe' },
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(validateEnvironment(process.env)))
      .overrideProvider(AcademicAiService)
      .useValue(ai)
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
    const databaseName = await db.$queryRaw<{ name: string }[]>`SELECT DATABASE() AS name`;
    expect(databaseName[0].name).toBe(DB_NAME);
    await app.get(GradingWorkerService).onModuleDestroy();
    const password = 'AcademicTest123!';
    const passwordHash = await bcrypt.hash(password, 4);
    for (const [key, role] of Object.entries({
      manager: 'MANAGER',
      staff: 'STAFF',
      teacher: 'TEACHER',
      outsider: 'TEACHER',
      designer: 'CURRICULUM_DESIGNER',
      parent: 'PARENT',
      otherParent: 'PARENT',
    } as const)) {
      const user = await db.user.create({
        data: { email: `${key}@academic.test`, passwordHash, role },
      });
      ids[key] = user.id;
      if (role === 'PARENT') await db.parentProfile.create({ data: { userId: user.id } });
      tokens[key] = (await app.get(AuthService).login(user.email, password)).tokens.accessToken;
    }
    const program = await db.program.create({
      data: { name: 'Math 8', subject: 'Math', grade: 8 },
    });
    ids.program = program.id;
    const lesson = await db.lesson.create({
      data: {
        programId: program.id,
        designerId: ids.designer,
        title: 'Fractions',
        content: 'Fractions',
        sequence: 1,
        status: 'APPROVED',
      },
    });
    ids.lesson = lesson.id;
    for (const name of ['classA', 'classB']) {
      const classroom = await db.class.create({
        data: {
          programId: program.id,
          name,
          teacherId: ids.teacher,
          capacity: 5,
          monthlyFee: 500000,
        },
      });
      ids[name] = classroom.id;
    }
    const parent = await db.parentProfile.findUniqueOrThrow({ where: { userId: ids.parent } });
    const student = await db.studentProfile.create({
      data: { parentProfileId: parent.id, fullName: 'Nguyen An', grade: 8 },
    });
    ids.student = student.id;
    const order = await db.registrationOrder.create({
      data: {
        type: 'FIRST_CHILD',
        parentEmail: 'parent@academic.test',
        studentFullName: student.fullName,
        studentGrade: 8,
        classId: ids.classA,
        packageMonths: 12,
        quotedAmount: 6000000,
        createdByManagerId: ids.manager,
        status: 'LINKED',
      },
    });
    const enrollment = await db.enrollment.create({
      data: {
        registrationOrderId: order.id,
        studentProfileId: student.id,
        classId: ids.classA,
        packageMonths: 12,
        status: 'ACTIVE',
        startDate: new Date('2020-01-01'),
        endDate: new Date('2040-12-31'),
      },
    });
    ids.enrollment = enrollment.id;
  }, 60000);

  afterAll(async () => {
    if (app) await app.close();
    const connection = await mysql.createConnection({
      host: DB_SERVER.hostname,
      port: Number(DB_SERVER.port || 3306),
      user: decodeURIComponent(DB_SERVER.username),
      password: decodeURIComponent(DB_SERVER.password),
    });
    await connection.query('DROP DATABASE IF EXISTS ??', [DB_NAME]);
    await connection.end();
  });

  it('enforces role and payload validation', async () => {
    await request(server).get('/api/v1/academic/classes').expect(401);
    await call('parent', 'post', 'programs')
      .send({ name: 'X', grade: 8, subject: 'Math' })
      .expect(403);
    await call('teacher', 'post', 'assignments').send({}).expect(400);
  });

  it('creates, publishes, submits, grades and publishes only reviewed results', async () => {
    const created = await call('teacher', 'post', 'assignments')
      .send({
        classId: ids.classA,
        title: 'Quiz',
        instructions: 'Choose one',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        maxAttempts: 1,
        questions: [
          {
            kind: 'MULTIPLE_CHOICE',
            prompt: '1+1?',
            choices: ['2', '3'],
            correctAnswer: '2',
            maxScore: 10,
          },
        ],
      })
      .expect(201);
    const assignment = (created.body as Envelope<WithId & { questions: WithId[] }>).data;
    ids.assignment = assignment.id;
    ids.question = assignment.questions[0].id;
    await call('outsider', 'get', `assignments/${assignment.id}`).expect(403);
    await call('parent', 'get', `assignments/${assignment.id}`).expect(403);
    await call('teacher', 'post', `assignments/${assignment.id}/publish`)
      .send({ enrollmentIds: [ids.enrollment] })
      .expect(201);
    const detail = await call('parent', 'get', `assignments/${assignment.id}`).expect(200);
    const data = (
      detail.body as Envelope<{ questions: Record<string, unknown>[]; recipients: WithId[] }>
    ).data;
    expect(data.questions[0]).not.toHaveProperty('correctAnswer');
    expect(data.questions[0]).not.toHaveProperty('rubric');
    await call('otherParent', 'post', 'submissions')
      .send({
        recipientId: data.recipients[0].id,
        answers: [{ questionId: ids.question, answer: '2' }],
      })
      .expect(403);
    const submit = await call('parent', 'post', 'submissions')
      .send({
        recipientId: data.recipients[0].id,
        answers: [{ questionId: ids.question, answer: '2' }],
      })
      .expect(201);
    ids.submission = (submit.body as Envelope<WithId>).data.id;
    await call('parent', 'post', 'submissions')
      .send({
        recipientId: data.recipients[0].id,
        answers: [{ questionId: ids.question, answer: '2' }],
      })
      .expect(409);
    const grade = await call(
      'teacher',
      'post',
      `submissions/${ids.submission}/grade-objective`,
    ).expect(201);
    ids.grade = (grade.body as Envelope<WithId>).data.id;
    await call('teacher', 'post', `grades/${ids.grade}/publish`).expect(409);
    const hidden = await call('parent', 'get', `assignments/${ids.assignment}/submissions`).expect(
      200,
    );
    expect((hidden.body as Envelope<{ grades: unknown[] }[]>).data[0].grades).toHaveLength(0);
    await call('teacher', 'post', `grades/${ids.grade}/approve`).expect(201);
    await call('teacher', 'post', `grades/${ids.grade}/publish`).expect(201);
    const visible = await call('parent', 'get', `assignments/${ids.assignment}/submissions`).expect(
      200,
    );
    expect(
      (visible.body as Envelope<{ grades: { totalScore: number }[] }[]>).data[0].grades[0]
        .totalScore,
    ).toBe(10);
    await call('teacher', 'post', `assignments/${ids.assignment}/publish-answers`).expect(409);
    await call('teacher', 'post', `assignments/${ids.assignment}/close`).expect(201);
    await call('teacher', 'post', `assignments/${ids.assignment}/publish-answers`).expect(201);
  });

  it('keeps AI suggestions separate and rejects invalid model scores', async () => {
    ai.json.mockResolvedValueOnce({
      scores: [{ questionId: ids.question, score: 7, feedback: 'Review' }],
    });
    const queued = await call('teacher', 'post', `submissions/${ids.submission}/grade-ai`).expect(
      201,
    );
    const jobId = (queued.body as Envelope<WithId>).data.id;
    await app.get(GradingWorkerService).tick();
    expect((await db.gradingJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe(
      'SUCCEEDED',
    );
    expect((await db.gradeReview.findUniqueOrThrow({ where: { id: ids.grade } })).totalScore).toBe(
      10,
    );
    await call('parent', 'get', `grading-jobs/${jobId}`).expect(403);
    ai.json.mockResolvedValueOnce({
      scores: [{ questionId: ids.question, score: 999, feedback: 'Bad' }],
    });
    const bad = await call('teacher', 'post', `submissions/${ids.submission}/grade-ai`).expect(201);
    await app.get(GradingWorkerService).tick();
    expect(
      (
        await db.gradingJob.findUniqueOrThrow({
          where: { id: (bad.body as Envelope<WithId>).data.id },
        })
      ).status,
    ).toBe('FAILED');
  });

  it('books makeup once, finalizes it and counts the original obligation once', async () => {
    const now = Date.now();
    const original = await db.classSession.create({
      data: {
        classId: ids.classA,
        lessonId: ids.lesson,
        teacherId: ids.teacher,
        startsAt: new Date(now - 4 * 86400000),
        endsAt: new Date(now - 4 * 86400000 + 3600000),
        status: 'COMPLETED',
      },
    });
    const source = await db.sessionParticipant.create({
      data: { sessionId: original.id, enrollmentId: ids.enrollment, attendance: 'ABSENT' },
    });
    const target = await db.classSession.create({
      data: {
        classId: ids.classB,
        lessonId: ids.lesson,
        teacherId: ids.teacher,
        startsAt: new Date(now + 86400000),
        endsAt: new Date(now + 86400000 + 3600000),
      },
    });
    // A future session can be made up in advance, but it is not a recorded absence yet.
    const upcoming = await db.classSession.create({
      data: {
        classId: ids.classA,
        lessonId: ids.lesson,
        teacherId: ids.teacher,
        startsAt: new Date(now + 3 * 86400000),
        endsAt: new Date(now + 3 * 86400000 + 3600000),
      },
    });
    const upcomingParticipant = await db.sessionParticipant.create({
      data: { sessionId: upcoming.id, enrollmentId: ids.enrollment },
    });
    const sourceIds = async (query: string): Promise<string[]> =>
      (
        (await call('staff', 'get', `makeup-sources?studentId=${ids.student}${query}`).expect(200))
          .body as Envelope<{ id: string }[]>
      ).data.map((item) => item.id);
    expect(await sourceIds('')).toEqual(
      expect.arrayContaining([source.id, upcomingParticipant.id]),
    );
    const recorded = await sourceIds('&completedOnly=true');
    expect(recorded).toContain(source.id);
    expect(recorded).not.toContain(upcomingParticipant.id);
    await db.sessionParticipant.delete({ where: { id: upcomingParticipant.id } });
    await db.classSession.delete({ where: { id: upcoming.id } });
    await call('manager', 'post', 'makeups')
      .send({ originalParticipantId: source.id, targetSessionId: target.id })
      .expect(403);
    const booked = await call('staff', 'post', 'makeups')
      .send({ originalParticipantId: source.id, targetSessionId: target.id })
      .expect(201);
    const booking = (booked.body as Envelope<WithId & { replacementParticipantId: string }>).data;
    await call('staff', 'post', 'makeups')
      .send({ originalParticipantId: source.id, targetSessionId: target.id })
      .expect(409);
    await db.classSession.update({
      where: { id: target.id },
      data: {
        startsAt: new Date(now - 2 * 86400000),
        endsAt: new Date(now - 2 * 86400000 + 3600000),
      },
    });
    await call('teacher', 'post', `sessions/${target.id}/finalize-attendance`)
      .send({ items: [{ participantId: booking.replacementParticipantId, status: 'PRESENT' }] })
      .expect(201);
    expect((await db.makeupBooking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
      'COMPLETED',
    );
    const report = await call('teacher', 'post', 'reports')
      .send({
        classId: ids.classA,
        from: new Date(now - 7 * 86400000).toISOString(),
        to: new Date(now + 10000).toISOString(),
      })
      .expect(201);
    ids.report = (report.body as Envelope<WithId>).data.id;
    const stored = await db.learningReport.findUniqueOrThrow({ where: { id: ids.report } });
    const snapshot = stored.snapshot as unknown as {
      rows: { required: number; attended: number; attendancePercent: number }[];
    };
    expect(snapshot.rows[0]).toMatchObject({ required: 1, attended: 1, attendancePercent: 100 });
    const range = new URLSearchParams({
      fromDate: new Date(now - 7 * 86400000).toISOString(),
      toDate: new Date(now + 10000).toISOString(),
    });
    for (const role of ['manager', 'staff']) {
      const summary = await call(
        role,
        'get',
        `classes/${ids.classA}/attendance-summary?${range}`,
      ).expect(200);
      const body = (
        summary.body as Envelope<{ students: { studentId: string; attendancePercent: number }[] }>
      ).data;
      expect(body.students).toEqual([
        expect.objectContaining({ studentId: ids.student, attendancePercent: 100 }),
      ]);
    }
    await call('manager', 'get', 'classes/missing-class/attendance-summary').expect(404);
    await call('designer', 'get', `classes/${ids.classA}/attendance-summary`).expect(403);
  });

  it('keeps class ownership until a scheduled teacher change and updates only future sessions', async () => {
    const classroom = await db.class.create({
      data: {
        programId: ids.program,
        name: 'Future teacher assignment',
        teacherId: ids.teacher,
        capacity: 5,
        monthlyFee: 500000,
      },
    });
    const now = Date.now();
    const before = await db.classSession.create({
      data: {
        classId: classroom.id,
        lessonId: ids.lesson,
        teacherId: ids.teacher,
        startsAt: new Date(now + 86400000),
        endsAt: new Date(now + 86400000 + 3600000),
      },
    });
    const after = await db.classSession.create({
      data: {
        classId: classroom.id,
        lessonId: ids.lesson,
        teacherId: ids.teacher,
        startsAt: new Date(now + 3 * 86400000),
        endsAt: new Date(now + 3 * 86400000 + 3600000),
      },
    });
    await request(server)
      .post(`/api/v1/classes/${classroom.id}/teacher-assignments`)
      .set('Authorization', `Bearer ${tokens.manager}`)
      .send({
        teacherId: ids.outsider,
        effectiveAt: new Date(now + 2 * 86400000).toISOString(),
        reason: 'Change next week',
      })
      .expect(201);
    expect((await db.class.findUniqueOrThrow({ where: { id: classroom.id } })).teacherId).toBe(
      ids.teacher,
    );
    expect((await db.classSession.findUniqueOrThrow({ where: { id: before.id } })).teacherId).toBe(
      ids.teacher,
    );
    expect((await db.classSession.findUniqueOrThrow({ where: { id: after.id } })).teacherId).toBe(
      ids.outsider,
    );
    await request(server)
      .get(`/api/v1/classes/${classroom.id}`)
      .set('Authorization', `Bearer ${tokens.teacher}`)
      .expect(200);
    await request(server)
      .get(`/api/v1/classes/${classroom.id}`)
      .set('Authorization', `Bearer ${tokens.outsider}`)
      .expect(403);
  });

  it('exports real Excel and PDF reports and denies other users', async () => {
    await call('manager', 'get', `reports/${ids.report}/download?format=xlsx`).expect(403);
    await call('outsider', 'get', `reports/${ids.report}/download?format=xlsx`).expect(403);
    const excel = await call('teacher', 'get', `reports/${ids.report}/download?format=xlsx`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    const workbook = new Workbook();
    await workbook.xlsx.load(excel.body as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.getWorksheet('Learning report')?.getCell('A2').value).toBe('Nguyen An');
    const pdf = await call('teacher', 'get', `reports/${ids.report}/download?format=pdf`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('approves a period pause, protects excused attendance and cancels it', async () => {
    const start = new Date(Date.now() + 5 * 86400000);
    start.setUTCHours(3, 0, 0, 0);
    const session = await db.classSession.create({
      data: {
        classId: ids.classA,
        lessonId: ids.lesson,
        teacherId: ids.teacher,
        startsAt: start,
        endsAt: new Date(start.getTime() + 3600000),
      },
    });
    await call('teacher', 'post', `sessions/${session.id}/roster`).expect(201);
    const date = start.toISOString().slice(0, 10);
    const leave = await call('parent', 'post', 'leaves')
      .send({
        enrollmentId: ids.enrollment,
        kind: 'PERIOD_PAUSE',
        fromDate: date,
        toDate: date,
        reason: 'Family leave',
      })
      .expect(201);
    const leaveId = (leave.body as Envelope<WithId>).data.id;
    await call('parent', 'post', `leaves/${leaveId}/decide`)
      .send({ approve: true, reason: 'Approved' })
      .expect(403);
    await call('manager', 'post', `leaves/${leaveId}/decide`)
      .send({ approve: true, reason: 'Approved' })
      .expect(403);
    await call('staff', 'post', `leaves/${leaveId}/decide`)
      .send({ approve: true, reason: 'Approved' })
      .expect(201);
    expect(
      (
        await db.sessionParticipant.findUniqueOrThrow({
          where: {
            sessionId_enrollmentId: { sessionId: session.id, enrollmentId: ids.enrollment },
          },
        })
      ).attendance,
    ).toBe('EXCUSED');
    await call('staff', 'post', `leaves/${leaveId}/cancel`).expect(201);
  });

  it('creates a single-session leave before roster preparation and rebooks a cancelled makeup', async () => {
    const now = Date.now();
    const sourceSession = await db.classSession.create({
      data: {
        classId: ids.classA,
        lessonId: ids.lesson,
        teacherId: ids.teacher,
        startsAt: new Date(now + 3 * 86400000),
        endsAt: new Date(now + 3 * 86400000 + 3600000),
      },
    });
    const day = new Date(sourceSession.startsAt.getTime() + 7 * 3600000).toISOString().slice(0, 10);
    await call('staff', 'post', 'leaves')
      .send({
        enrollmentId: ids.enrollment,
        sessionId: sourceSession.id,
        kind: 'SINGLE_ABSENCE',
        fromDate: day,
        toDate: day,
        reason: 'Planned absence',
      })
      .expect(201);
    const source = await db.sessionParticipant.findUniqueOrThrow({
      where: {
        sessionId_enrollmentId: {
          sessionId: sourceSession.id,
          enrollmentId: ids.enrollment,
        },
      },
    });
    const target = await db.classSession.create({
      data: {
        classId: ids.classB,
        lessonId: ids.lesson,
        teacherId: ids.teacher,
        startsAt: new Date(now + 4 * 86400000),
        endsAt: new Date(now + 4 * 86400000 + 3600000),
      },
    });
    const first = await call('staff', 'post', 'makeups')
      .send({ originalParticipantId: source.id, targetSessionId: target.id })
      .expect(201);
    const firstBooking = (first.body as Envelope<WithId>).data;
    await call('staff', 'post', `makeups/${firstBooking.id}/cancel`).expect(201);
    const second = await call('staff', 'post', 'makeups')
      .send({ originalParticipantId: source.id, targetSessionId: target.id })
      .expect(201);
    expect((second.body as Envelope<WithId>).data.id).not.toBe(firstBooking.id);
    expect(
      await db.makeupBooking.count({
        where: { replacement: { sessionId: target.id, enrollmentId: ids.enrollment } },
      }),
    ).toBe(2);
    expect(
      await db.makeupBooking.count({
        where: {
          replacement: { sessionId: target.id, enrollmentId: ids.enrollment },
          status: 'BOOKED',
        },
      }),
    ).toBe(1);
    const targetDate = new Date(target.startsAt.getTime() + 7 * 3600000).toISOString().slice(0, 10);
    const calendar = await call(
      'parent',
      'get',
      `scheduled-sessions?studentId=${ids.student}&fromDate=${targetDate}&toDate=${targetDate}`,
    ).expect(200);
    await call(
      'otherParent',
      'get',
      `scheduled-sessions?studentId=${ids.student}&fromDate=${targetDate}&toDate=${targetDate}`,
    ).expect(403);
    const targetEntry = (
      calendar.body as Envelope<
        Array<{
          id: string;
          participations: Array<{
            kind: string;
            replacementMakeups: Array<{ sourceSessionId: string }>;
          }>;
        }>
      >
    ).data.find((item) => item.id === target.id);
    expect(targetEntry?.participations[0].kind).toBe('MAKEUP');
    expect(
      targetEntry?.participations[0].replacementMakeups.find(
        (booking) => booking.sourceSessionId === sourceSession.id,
      ),
    ).toBeDefined();
    await call(
      'staff',
      'post',
      `makeups/${(second.body as Envelope<WithId>).data.id}/cancel`,
    ).expect(201);
  });

  it('transfers enrollment without rewriting the original class and ends only that child', async () => {
    await db.classSession.create({
      data: {
        classId: ids.classB,
        lessonId: ids.lesson,
        teacherId: ids.teacher,
        startsAt: new Date(Date.now() + 6 * 86400000),
        endsAt: new Date(Date.now() + 6 * 86400000 + 3600000),
      },
    });
    await call('manager', 'post', `enrollments/${ids.enrollment}/transfer`)
      .send({
        targetClassId: ids.classB,
        effectiveAt: new Date(Date.now() + 2 * 86400000).toISOString(),
        reason: 'Schedule changed',
      })
      .expect(403);
    await call('staff', 'post', `enrollments/${ids.enrollment}/transfer`)
      .send({
        targetClassId: ids.classB,
        effectiveAt: new Date(Date.now() + 2 * 86400000).toISOString(),
        reason: 'Schedule changed',
      })
      .expect(201);
    const enrollment = await db.enrollment.findUniqueOrThrow({
      where: { id: ids.enrollment },
      include: { placements: true },
    });
    expect(enrollment.classId).toBe(ids.classA);
    expect(enrollment.placements).toHaveLength(2);
    await db.class.updateMany({
      where: { id: { in: [ids.classA, ids.classB] } },
      data: { capacity: 1 },
    });
    const termStart = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const classList = await request(server)
      .get('/api/v1/classes')
      .set('Authorization', `Bearer ${tokens.parent}`)
      .query({ startDate: termStart, packageMonths: 1 })
      .expect(200);
    const classes = (classList.body as Envelope<Array<{ id: string; availableSeats: number }>>)
      .data;
    expect(classes.find((row) => row.id === ids.classB)?.availableSeats).toBe(0);
    expect(classes.find((row) => row.id === ids.classA)?.availableSeats).toBe(1);
    await call('staff', 'post', `students/${ids.student}/end-study`).expect(201);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: ids.enrollment } })).status).toBe(
      'ENDED',
    );
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.parent } })).status).toBe('ACTIVE');
    await call('staff', 'post', `students/${ids.student}/reactivate`)
      .send({ reason: 'Student returns' })
      .expect(201);
    expect((await db.studentProfile.findUniqueOrThrow({ where: { id: ids.student } })).status).toBe(
      'ACTIVE',
    );
  });

  it('serializes competing requests for the last makeup seat', async () => {
    const parent = await db.parentProfile.findUniqueOrThrow({ where: { userId: ids.parent } });
    const sources: string[] = [];
    const now = Date.now();
    const original = await db.classSession.create({
      data: {
        classId: ids.classA,
        lessonId: ids.lesson,
        teacherId: ids.teacher,
        startsAt: new Date(now - 15 * 86400000),
        endsAt: new Date(now - 15 * 86400000 + 3600000),
        status: 'COMPLETED',
      },
    });
    for (let index = 0; index < 2; index++) {
      const student = await db.studentProfile.create({
        data: { parentProfileId: parent.id, fullName: `Seat test ${index}`, grade: 8 },
      });
      const order = await db.registrationOrder.create({
        data: {
          type: 'NEW_CHILD',
          parentEmail: 'parent@academic.test',
          studentFullName: student.fullName,
          studentGrade: 8,
          classId: ids.classA,
          packageMonths: 1,
          quotedAmount: 500000,
          createdByManagerId: ids.manager,
          status: 'LINKED',
        },
      });
      const enrollment = await db.enrollment.create({
        data: {
          registrationOrderId: order.id,
          studentProfileId: student.id,
          classId: ids.classA,
          packageMonths: 1,
          status: 'ACTIVE',
          startDate: new Date('2020-01-01'),
          endDate: new Date('2040-12-31'),
        },
      });
      const source = await db.sessionParticipant.create({
        data: { sessionId: original.id, enrollmentId: enrollment.id, attendance: 'ABSENT' },
      });
      sources.push(source.id);
    }
    await db.class.update({ where: { id: ids.classB }, data: { capacity: 1 } });
    const target = await db.classSession.create({
      data: {
        classId: ids.classB,
        lessonId: ids.lesson,
        teacherId: ids.teacher,
        startsAt: new Date(now + 12 * 86400000),
        endsAt: new Date(now + 12 * 86400000 + 3600000),
      },
    });
    const responses = await Promise.all(
      sources.map((originalParticipantId) =>
        call('staff', 'post', 'makeups').send({
          originalParticipantId,
          targetSessionId: target.id,
        }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await db.sessionParticipant.count({ where: { sessionId: target.id, cancelled: false } }),
    ).toBe(1);
    await db.class.update({ where: { id: ids.classB }, data: { capacity: 5 } });
  });

  it('handles feedback and queues announcement email without SMTP', async () => {
    const feedback = await call('teacher', 'post', `lessons/${ids.lesson}/feedback`)
      .send({ content: 'Add an example' })
      .expect(201);
    const revised = await call('designer', 'post', `lessons/${ids.lesson}/revisions`)
      .send({ title: 'Fractions revised', content: 'An extra example' })
      .expect(201);
    const revisedId = (revised.body as Envelope<WithId>).data.id;
    await call('manager', 'post', `lessons/${revisedId}/approve`).expect(201);
    await call(
      'designer',
      'post',
      `feedback/${(feedback.body as Envelope<WithId>).data.id}/resolve`,
    )
      .send({
        status: 'RESOLVED',
        response: 'Reviewed and addressed',
        resolutionLessonId: revisedId,
      })
      .expect(201);
    app.get(ConfigService).set('academic.smtpUrl', '');
    const announcement = await call('manager', 'post', 'announcements')
      .send({ classId: ids.classA, title: 'Holiday', content: 'Class update' })
      .expect(201);
    await call(
      'manager',
      'post',
      `announcements/${(announcement.body as Envelope<WithId>).data.id}/send-email`,
    ).expect(201);
    expect(
      await db.outboxEvent.count({
        where: {
          eventType: 'ANNOUNCEMENT',
          aggregateId: (announcement.body as Envelope<WithId>).data.id,
        },
      }),
    ).toBeGreaterThan(0);
    const queued = await db.outboxEvent.findFirstOrThrow({
      where: {
        eventType: 'ANNOUNCEMENT',
        aggregateId: (announcement.body as Envelope<WithId>).data.id,
      },
    });
    app.get(ConfigService).set('academic.smtpUrl', 'smtp://127.0.0.1:1');
    app.get(ConfigService).set('academic.mailFrom', 'test@example.com');
    const failed = await call('manager', 'post', `email-deliveries/${queued.id}/retry`).expect(502);
    expect((failed.body as { error: { code: string } }).error.code).toBe('EMAIL_DELIVERY_FAILED');
    const attempt = await db.outboxEvent.findUniqueOrThrow({ where: { id: queued.id } });
    expect(attempt.attemptCount).toBe(1);
    expect(attempt.lastError).toBeTruthy();
    await db.outboxEvent.update({ where: { id: queued.id }, data: { status: 'FAILED' } });
    const failedList = await call(
      'staff',
      'get',
      'email-deliveries?status=FAILED&limit=100',
    ).expect(200);
    const failedPage = (
      failedList.body as Envelope<{ items: { id: string; status: string }[]; total: number }>
    ).data;
    expect(failedPage.items.map((item) => item.id)).toContain(queued.id);
    expect(failedPage.items.every((item) => item.status === 'FAILED')).toBe(true);
    expect(failedPage.total).toBe(await db.outboxEvent.count({ where: { status: 'FAILED' } }));
    const sent = await call('manager', 'get', 'email-deliveries?status=SENT').expect(200);
    expect(
      (sent.body as Envelope<{ items: { id: string }[] }>).data.items.map((item) => item.id),
    ).not.toContain(queued.id);
    await call('manager', 'get', 'email-deliveries?status=LOST').expect(400);
  });
});

function binaryParser(
  response: request.Response,
  callback: (error: Error | null, body?: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', callback);
}
