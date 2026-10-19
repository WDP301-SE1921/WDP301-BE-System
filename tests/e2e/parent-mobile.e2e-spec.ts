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

type Envelope<T> = { data: T };
const DB_NAME = 'edugrade_parent_mobile_test';
const DB_SERVER = new URL(
  process.env.ACADEMIC_TEST_DATABASE_URL ?? 'mysql://root:admin123@localhost:3306',
);
const DB_URL = `mysql://${DB_SERVER.username}:${DB_SERVER.password}@${DB_SERVER.host}/${DB_NAME}`;

describe('Parent mobile contracts and isolation', () => {
  let app: INestApplication;
  let server: Server;
  let db: DatabaseService;
  let created = false;
  let token: string;
  const ids: Record<string, string> = {};
  const get = (path: string): request.Test =>
    request(server).get(`/api/v1/${path}`).set('Authorization', `Bearer ${token}`);
  const patch = (body: object): request.Test =>
    request(server).patch('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).send(body);
  const dates = { from: '2020-01-01', to: '2040-01-01' };
  const calendar = (): string =>
    `academic/scheduled-sessions?studentId=${ids.child}&fromDate=2027-03-01&toDate=2027-03-31`;

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: DB_URL,
      CORS_ORIGINS: 'http://localhost:3000',
      SWAGGER_ENABLED: 'false',
      JWT_ACCESS_SECRET: 'parent-mobile-access-secret-at-least-32-characters',
      JWT_REFRESH_SECRET: 'parent-mobile-refresh-secret-at-least-32-characters',
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
    created = true;
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
    const password = 'ParentMobile123!';
    const passwordHash = await bcrypt.hash(password, 4);
    for (const [key, role] of Object.entries({
      parent: 'PARENT',
      foreignParent: 'PARENT',
      teacher: 'TEACHER',
      manager: 'MANAGER',
      designer: 'CURRICULUM_DESIGNER',
    } as const)) {
      const user = await db.user.create({
        data: {
          email: `${key}@parent-mobile.test`,
          role,
          passwordHash,
          displayName: key,
          emailVerifiedAt: new Date(),
        },
      });
      ids[key] = user.id;
      if (role === 'PARENT')
        await db.parentProfile.create({ data: { userId: user.id, phone: '0901234567' } });
    }
    token = (await app.get(AuthService).login('parent@parent-mobile.test', password)).tokens
      .accessToken;
    const program = await db.program.create({
      data: { name: 'Math 8', subject: 'Math', grade: 8 },
    });
    ids.program = program.id;
    const room = await db.room.create({ data: { name: 'Room 101', capacity: 20 } });
    for (const name of ['classA', 'classB', 'oldClass']) {
      const classroom = await db.class.create({
        data: {
          name,
          programId: program.id,
          teacherId: ids.teacher,
          roomId: room.id,
          capacity: 20,
          monthlyFee: 500000,
        },
      });
      ids[name] = classroom.id;
    }
    const track = await db.curriculumTrack.create({
      data: { grade: 8, subject: 'Math', subjectKey: 'math' },
    });
    for (const [name, status] of Object.entries({
      unit: 'APPROVED',
      draftUnit: 'DRAFT',
    } as const)) {
      const unit = await db.curriculumUnit.create({
        data: {
          trackId: track.id,
          programId: program.id,
          designerId: ids.designer,
          title: name,
          fromDate: new Date('2026-10-01'),
          toDate: new Date('2026-10-31'),
          status,
          version: name === 'unit' ? 1 : 2,
        },
      });
      ids[name] = unit.id;
      const lesson = await db.lesson.create({
        data: {
          unitId: unit.id,
          programId: program.id,
          designerId: ids.designer,
          title: `${name} lesson`,
          content: 'SECRET ANSWER KEY',
          sequence: 1,
          status: 'APPROVED',
        },
      });
      if (name === 'unit') ids.lesson = lesson.id;
    }
    for (const name of ['child', 'sibling', 'foreignChild']) {
      const parent = await db.parentProfile.findUniqueOrThrow({
        where: { userId: name === 'foreignChild' ? ids.foreignParent : ids.parent },
      });
      const child = await db.studentProfile.create({
        data: { parentProfileId: parent.id, fullName: name, grade: 8 },
      });
      ids[name] = child.id;
      const order = await db.registrationOrder.create({
        data: {
          type: 'FIRST_CHILD',
          parentEmail: `${parent.userId}@test.invalid`,
          studentFullName: name,
          studentGrade: 8,
          classId: ids.classA,
          targetStudentId: child.id,
          packageMonths: 12,
          quotedAmount: 6000000,
          createdByManagerId: ids.manager,
          status: 'COMPLETED',
        },
      });
      const enrollment = await db.enrollment.create({
        data: {
          registrationOrderId: order.id,
          studentProfileId: child.id,
          classId: ids.classA,
          packageMonths: 12,
          status: 'ACTIVE',
          startDate: new Date(dates.from),
          endDate: new Date(dates.to),
        },
      });
      ids[`${name}Enrollment`] = enrollment.id;
    }
    for (const [index, name] of [
      'regular',
      'cancelledSession',
      'lostRegular',
      'oldSession',
      'makeup',
      'cancelledMakeup',
      'absent',
      'present',
      'excused',
    ].entries()) {
      const session = await db.classSession.create({
        data: {
          classId:
            name === 'oldSession'
              ? ids.oldClass
              : name.toLowerCase().includes('makeup')
                ? ids.classB
                : ids.classA,
          lessonId: ids.lesson,
          teacherId: ids.teacher,
          roomId: room.id,
          startsAt: new Date(`2027-03-${String(index + 1).padStart(2, '0')}T10:00:00Z`),
          endsAt: new Date(`2027-03-${String(index + 1).padStart(2, '0')}T11:00:00Z`),
          status:
            name === 'cancelledSession'
              ? 'CANCELLED'
              : ['absent', 'present', 'excused'].includes(name)
                ? 'COMPLETED'
                : 'SCHEDULED',
          cancelReason: name === 'cancelledSession' ? 'Center closed' : null,
        },
      });
      ids[name] = session.id;
      const participant = await db.sessionParticipant.create({
        data: {
          sessionId: session.id,
          enrollmentId: ids.childEnrollment,
          kind: name.toLowerCase().includes('makeup') ? 'MAKEUP' : 'REGULAR',
          cancelled: ['lostRegular', 'oldSession', 'cancelledMakeup'].includes(name),
          attendance:
            name === 'present'
              ? 'PRESENT'
              : name === 'excused'
                ? 'EXCUSED'
                : name === 'absent'
                  ? 'ABSENT'
                  : 'UNMARKED',
        },
      });
      ids[`${name}Participant`] = participant.id;
    }
    const makeup = await db.makeupBooking.create({
      data: {
        originalParticipantId: ids.absentParticipant,
        replacementParticipantId: ids.makeupParticipant,
        status: 'BOOKED',
        managerId: ids.manager,
      },
    });
    ids.booking = makeup.id;
    await db.leaveRequest.create({
      data: {
        enrollmentId: ids.childEnrollment,
        sessionId: ids.excused,
        kind: 'SINGLE_ABSENCE',
        fromDate: new Date('2027-03-09'),
        toDate: new Date('2027-03-09'),
        reason: 'Family reason',
        requestedById: ids.parent,
        status: 'APPROVED',
      },
    });
    for (const name of ['child', 'sibling', 'foreignChild']) {
      const assignment = await db.assignment.create({
        data: {
          classId: ids.classA,
          teacherId: ids.teacher,
          title: `${name} quiz`,
          instructions: 'Solve',
          dueAt: new Date('2040-01-01'),
          status: 'PUBLISHED',
          kind: 'TEST',
          testType: 'FIFTEEN_MINUTES',
          sessionId: ids.regular,
          questions: {
            create: {
              position: 0,
              kind: 'MULTIPLE_CHOICE',
              prompt: '1+1?',
              choices: ['2', '3'],
              correctAnswer: '2',
              maxScore: 20,
            },
          },
          recipients: { create: { enrollmentId: ids[`${name}Enrollment`] } },
        },
      });
      ids[`${name}Assignment`] = assignment.id;
    }
    const recipient = await db.assignmentRecipient.findFirstOrThrow({
      where: { assignmentId: ids.childAssignment },
    });
    const first = await db.submission.create({
      data: {
        recipientId: recipient.id,
        attemptNo: 1,
        answers: [],
        grades: {
          create: {
            revision: 1,
            reviewerId: ids.teacher,
            status: 'PUBLISHED',
            scores: [],
            totalScore: 16,
            feedback: 'Published',
            publishedAt: new Date(),
          },
        },
      },
    });
    ids.firstSubmission = first.id;
    await db.submission.create({
      data: {
        recipientId: recipient.id,
        attemptNo: 2,
        answers: [],
        grades: {
          create: {
            revision: 1,
            reviewerId: ids.teacher,
            status: 'DRAFT',
            scores: [],
            totalScore: 20,
            feedback: 'SECRET DRAFT FEEDBACK',
          },
        },
      },
    });
    await db.assignment.create({
      data: {
        classId: ids.classA,
        teacherId: ids.teacher,
        title: 'SECRET DRAFT ASSIGNMENT',
        instructions: 'Secret',
        dueAt: new Date('2040-01-01'),
        recipients: { create: { enrollmentId: ids.childEnrollment } },
      },
    });
  }, 90_000);

  afterAll(async () => {
    if (app) await app.close();
    if (!created) return;
    const connection = await mysql.createConnection({
      host: DB_SERVER.hostname,
      port: Number(DB_SERVER.port || 3306),
      user: decodeURIComponent(DB_SERVER.username),
      password: decodeURIComponent(DB_SERVER.password),
    });
    await connection.query('DROP DATABASE IF EXISTS ??', [DB_NAME]);
    await connection.end();
  });

  it('keeps canceled center sessions, hides lost seats and paginates the authorized calendar', async () => {
    const legacy = await get(calendar()).expect(200);
    const rows = (
      legacy.body as Envelope<
        Array<{ id: string; cancelReason: string; teacher: unknown; room: unknown }>
      >
    ).data;
    expect(rows.map((row) => row.id)).toEqual(
      expect.arrayContaining([ids.regular, ids.cancelledSession, ids.makeup]),
    );
    for (const id of [ids.lostRegular, ids.oldSession, ids.cancelledMakeup])
      expect(rows.map((row) => row.id)).not.toContain(id);
    expect(rows.find((row) => row.id === ids.cancelledSession)).toMatchObject({
      cancelReason: 'Center closed',
      teacher: { displayName: 'teacher' },
      room: { name: 'Room 101' },
    });
    const page = await get(`${calendar()}&paginated=true&limit=2&page=2`).expect(200);
    expect((page.body as Envelope<unknown>).data).toMatchObject({
      total: rows.length,
      page: 2,
      limit: 2,
      items: rows.slice(2, 4),
    });
    const empty = await get(`${calendar()}&paginated=true&limit=2&page=100`).expect(200);
    expect((empty.body as Envelope<unknown>).data).toMatchObject({ total: rows.length, items: [] });
    await get(calendar().replace(ids.child, ids.foreignChild)).expect(403);
  });

  it('uses the exclusive term end and preserves historical sessions of ended enrollments', async () => {
    await db.enrollment.update({
      where: { id: ids.siblingEnrollment },
      data: { startDate: new Date('2027-03-01'), endDate: new Date('2027-03-03') },
    });
    const response = await get(calendar().replace(ids.child, ids.sibling)).expect(200);
    expect((response.body as Envelope<Array<{ id: string }>>).data.map((row) => row.id)).toEqual([
      ids.regular,
      ids.cancelledSession,
    ]);
    await db.enrollment.update({
      where: { id: ids.siblingEnrollment },
      data: { status: 'ENDED', endedAt: new Date('2027-03-02T00:00:00+07:00') },
    });
    const ended = await get(calendar().replace(ids.child, ids.sibling)).expect(200);
    expect((ended.body as Envelope<Array<{ id: string }>>).data.map((row) => row.id)).toEqual([
      ids.regular,
    ]);
    await db.enrollment.update({
      where: { id: ids.siblingEnrollment },
      data: {
        status: 'ACTIVE',
        endedAt: null,
        startDate: new Date(dates.from),
        endDate: new Date(dates.to),
      },
    });
  });

  it('validates assignment metadata and clears test type when changing a draft to homework', async () => {
    const teacherToken = (
      await app.get(AuthService).login('teacher@parent-mobile.test', 'ParentMobile123!')
    ).tokens.accessToken;
    const body = {
      classId: ids.classA,
      title: 'Metadata test',
      instructions: 'Choose',
      dueAt: '2040-01-01T00:00:00Z',
      maxAttempts: 1,
      kind: 'TEST',
      testType: 'ONE_PERIOD',
      sessionId: ids.regular,
      questions: [
        {
          kind: 'MULTIPLE_CHOICE',
          prompt: '1+1?',
          choices: ['2', '3'],
          correctAnswer: '2',
          maxScore: 10,
        },
      ],
    };
    const post = (input: object): request.Test =>
      request(server)
        .post('/api/v1/academic/assignments')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send(input);
    await post({ ...body, sessionId: ids.makeup }).expect(409);
    await post({ ...body, kind: 'HOMEWORK' }).expect(409);
    const valid = await post(body).expect(201);
    const assignment = (valid.body as Envelope<{ id: string }>).data;
    const changed = await request(server)
      .patch(`/api/v1/academic/assignments/${assignment.id}`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ ...body, kind: 'HOMEWORK', testType: undefined })
      .expect(200);
    expect((changed.body as Envelope<unknown>).data).toMatchObject({
      kind: 'HOMEWORK',
      testType: null,
    });
    await get(`academic/assignments/${assignment.id}`).expect(403);
  });

  it('limits session details and denies canceled participation', async () => {
    for (const id of [ids.regular, ids.cancelledSession, ids.makeup]) {
      const response = await get(`academic/scheduled-sessions/${id}?studentId=${ids.child}`).expect(
        200,
      );
      const row = (response.body as Envelope<Record<string, unknown>>).data;
      expect(row).not.toHaveProperty('lesson.content');
      expect(row).not.toHaveProperty('class.monthlyFee');
      expect(row).not.toHaveProperty('class.teacherId');
      expect(row).toHaveProperty('room.name', 'Room 101');
    }
    for (const id of [ids.lostRegular, ids.oldSession, ids.cancelledMakeup])
      await get(`academic/scheduled-sessions/${id}?studentId=${ids.child}`).expect(403);
    await get(`academic/scheduled-sessions/does-not-exist?studentId=${ids.child}`).expect(404);
  });

  it('separates children and returns latest work without unpublished grades or answer keys', async () => {
    const response = await get(`academic/assignments?studentId=${ids.child}&paginated=true`).expect(
      200,
    );
    const data = (
      response.body as Envelope<{ total: number; items: Array<Record<string, unknown>> }>
    ).data;
    expect(data.total).toBe(1);
    expect(data.items[0]).toMatchObject({
      id: ids.childAssignment,
      kind: 'TEST',
      testType: 'FIFTEEN_MINUTES',
      maxScore: 20,
      questionCounts: { total: 1, multipleChoice: 1 },
      class: { name: 'classA' },
      recipients: [
        { studentId: ids.child, latestSubmission: { attemptNo: 2, publishedGrade: null } },
      ],
    });
    expect(JSON.stringify(data)).not.toContain('correctAnswer');
    expect(JSON.stringify(data)).not.toContain('SECRET');
    const sibling = await get(`academic/assignments?studentId=${ids.sibling}`).expect(200);
    expect((sibling.body as Envelope<Array<{ id: string }>>).data.map((item) => item.id)).toEqual([
      ids.siblingAssignment,
    ]);
    await get(`academic/assignments?studentId=${ids.foreignChild}`).expect(403);
    const submissions = await get(
      `academic/assignments/${ids.childAssignment}/submissions?paginated=true&limit=1`,
    ).expect(200);
    expect((submissions.body as Envelope<unknown>).data).toMatchObject({
      total: 2,
      items: [{ attemptNo: 2, grades: [] }],
    });
  });

  it('summarizes only published results and normalizes the average to ten', async () => {
    const response = await get(`academic/me/students/${ids.child}/grades`).expect(200);
    expect((response.body as Envelope<unknown>).data).toMatchObject({
      subjects: [{ subject: 'Math', count: 1, averageOutOf10: 8 }],
      history: [
        { submissionId: ids.firstSubmission, totalScore: 16, maxScore: 20, scoreOutOf10: 8 },
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain('SECRET');
    await get(`academic/me/students/${ids.foreignChild}/grades`).expect(403);
  });

  it('returns leave and makeup context while BOOKED makeup does not count as attended', async () => {
    const url = `academic/me/students/${ids.child}/attendance?fromDate=2027-03-01&toDate=2027-03-31`;
    const response = await get(url).expect(200);
    const data = (
      response.body as Envelope<{
        counts: unknown;
        attendancePercent: number;
        history: Array<Record<string, unknown>>;
      }>
    ).data;
    expect(data.counts).toMatchObject({ absent: 1, present: 1, excused: 1, madeUp: 0 });
    expect(data.attendancePercent).toBe(50);
    expect(
      data.history.find(
        (row) =>
          row.enrollmentId === ids.childEnrollment &&
          (row.session as { id: string }).id === ids.absent,
      ),
    ).toMatchObject({
      class: { name: 'classA', program: { subject: 'Math' } },
      latestMakeup: { status: 'BOOKED', replacement: { session: { id: ids.makeup } } },
    });
    expect(
      data.history.find((row) => (row.session as { id: string }).id === ids.excused),
    ).toMatchObject({ approvedLeave: { reason: 'Family reason', kind: 'SINGLE_ABSENCE' } });
    expect(data.history[0]).toHaveProperty('enrollment.studentProfile.id', ids.child);
    await db.makeupBooking.update({ where: { id: ids.booking }, data: { status: 'COMPLETED' } });
    const completed = await get(url).expect(200);
    expect((completed.body as Envelope<unknown>).data).toMatchObject({
      counts: { madeUp: 1, absent: 0 },
      attendancePercent: 100,
    });
    const leaves = await get(`academic/leaves?studentId=${ids.child}&paginated=true`).expect(200);
    expect((leaves.body as Envelope<unknown>).data).toMatchObject({ total: 1 });
    const makeups = await get(`academic/makeups?studentId=${ids.sibling}&paginated=true`).expect(
      200,
    );
    expect((makeups.body as Envelope<unknown>).data).toMatchObject({ total: 0, items: [] });
  });

  it('exposes only approved curriculum outlines, including lessons with no scheduled session', async () => {
    const unscheduled = await db.lesson.create({
      data: {
        unitId: ids.unit,
        programId: ids.program,
        designerId: ids.designer,
        title: 'Unscheduled lesson',
        content: 'SECRET',
        sequence: 2,
        status: 'APPROVED',
      },
    });
    const response = await get(`academic/me/students/${ids.child}/curriculum`).expect(200);
    const data = (
      response.body as Envelope<{ items: Array<{ id: string; lessons: Array<{ id: string }> }> }>
    ).data;
    expect(data.items.map((unit) => unit.id)).toEqual([ids.unit]);
    expect(data.items[0].lessons.map((lesson) => lesson.id)).toContain(unscheduled.id);
    expect(JSON.stringify(data)).not.toContain('content');
    expect(JSON.stringify(data)).not.toContain('SECRET');
    await get(`academic/me/students/${ids.foreignChild}/curriculum`).expect(403);
  });

  it('returns stored parent phone after updates and preserves it when omitted', async () => {
    expect(((await get('auth/me').expect(200)).body as Envelope<unknown>).data).toMatchObject({
      phone: '0901234567',
    });
    expect(
      ((await patch({ phone: '0912345678' }).expect(200)).body as Envelope<unknown>).data,
    ).toMatchObject({ phone: '0912345678' });
    expect(
      ((await patch({ displayName: 'New name' }).expect(200)).body as Envelope<unknown>).data,
    ).toMatchObject({ phone: '0912345678' });
    expect(((await get('auth/me').expect(200)).body as Envelope<unknown>).data).toMatchObject({
      phone: '0912345678',
    });
    expect(((await patch({ phone: '' }).expect(200)).body as Envelope<unknown>).data).toMatchObject(
      { phone: null },
    );
  });

  it('computes expired term state without rewriting enrollment status and includes teacher names', async () => {
    await db.enrollment.update({
      where: { id: ids.siblingEnrollment },
      data: { endDate: new Date('2021-01-01') },
    });
    const response = await get(`me/students/${ids.sibling}/enrollments`).expect(200);
    expect((response.body as Envelope<unknown[]>).data[0]).toMatchObject({
      id: ids.siblingEnrollment,
      status: 'ACTIVE',
      term: { status: 'EXPIRED' },
      class: { teacher: { displayName: 'teacher' } },
    });
  });
});
