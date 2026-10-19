import { JwtService } from '@nestjs/jwt';
import { io, type Socket } from 'socket.io-client';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { NotificationsWorker } from '../../src/modules/notifications/notifications.worker';
import { NotificationsGateway } from '../../src/modules/notifications/notifications.gateway';
import { NotificationEventsService } from '../../src/modules/notifications/notification-events.service';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import * as mysql from 'mysql2/promise';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../src/app.module';
import type { AppConfiguration } from '../../src/config/configuration';
import { validateEnvironment } from '../../src/config/configuration';
import { DatabaseService } from '../../src/database/orm/database.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { GradingWorkerService } from '../../src/modules/academic/grading-worker.service';

type Envelope<T> = { data: T };
const DB_NAME = 'edugrade_notifications_test';
const DB_SERVER = new URL(
  process.env.ACADEMIC_TEST_DATABASE_URL ?? 'mysql://root:admin123@localhost:3306',
);
const DB_URL = `mysql://${DB_SERVER.username}:${DB_SERVER.password}@${DB_SERVER.host}/${DB_NAME}`;

describe('Notification inbox, transactions and realtime', () => {
  let app: INestApplication;
  let server: Server;
  let db: DatabaseService;
  let created = false;
  let token: string;
  const ids: Record<string, string> = {};
  const get = (path: string): request.Test =>
    request(server).get(`/api/v1/${path}`).set('Authorization', `Bearer ${token}`);
  const dates = { from: '2020-01-01', to: '2040-01-01' };

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
    await app.listen(0);
    server = app.getHttpServer() as Server;
    db = app.get(DatabaseService);
    await app.get(GradingWorkerService).onModuleDestroy();
    await app.get(NotificationsWorker).onModuleDestroy();
    const password = 'ParentMobile123!';
    const passwordHash = await bcrypt.hash(password, 4);
    for (const [key, role] of Object.entries({
      parent: 'PARENT',
      foreignParent: 'PARENT',
      teacher: 'TEACHER',
      manager: 'MANAGER',
      designer: 'CURRICULUM_DESIGNER',
      staff: 'STAFF',
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
    for (const socket of clients) socket.disconnect();
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

  const clients: Socket[] = [];
  const login = async (name: string): Promise<string> =>
    (await app.get(AuthService).login(`${name}@parent-mobile.test`, 'ParentMobile123!')).tokens
      .accessToken;
  const http = (auth: string, method: 'get' | 'post' | 'patch', path: string): request.Test =>
    request(server)[method](`/api/v1/${path}`).set('Authorization', `Bearer ${auth}`);
  const notify = async (
    eventKey: string,
    recipients = [{ userId: ids.parent, studentIds: [ids.child] }],
  ): Promise<void> => {
    await db.$transaction((tx) =>
      app.get(NotificationsService).record(tx, {
        eventKey,
        actorId: ids.manager,
        type: 'ANNOUNCEMENT',
        title: 'Thông báo',
        body: 'Thông tin lớp học',
        targetKind: 'CLASS',
        targetId: ids.classA,
        classId: ids.classA,
        recipients,
      }),
    );
  };
  const connect = async (auth: string): Promise<Socket> => {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    const socket = io(`http://localhost:${address.port}/notifications`, {
      path: '/socket.io',
      auth: { token: auth },
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
    });
    clients.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    return socket;
  };
  const event = <T>(socket: Socket, name: string): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Missing ${name}`)), 3000);
      socket.once(name, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  it('allows each role to access only its own inbox, including pagination and child filtering', async () => {
    await request(server).get('/api/v1/notifications').expect(401);
    for (const role of ['parent', 'foreignParent', 'teacher', 'manager', 'designer', 'staff']) {
      await notify(`role:${role}`, [{ userId: ids[role], studentIds: [ids.child] }]);
      const auth = await login(role);
      const response = await http(auth, 'get', 'notifications?limit=1').expect(200);
      const data = (
        response.body as Envelope<{ items: Array<{ id: string; type: string }>; total: number }>
      ).data;
      expect(data.total).toBe(role === 'manager' ? 0 : 1);
      if (role === 'parent') {
        const id = data.items[0].id;
        const outsider = await login('foreignParent');
        await http(outsider, 'patch', `notifications/${id}/read`).expect(404);
      }
    }
    await notify('sibling-context', [{ userId: ids.parent, studentIds: [ids.sibling] }]);
    const onlyChild = await get(`notifications?studentId=${ids.child}`).expect(200);
    expect((onlyChild.body as Envelope<{ total: number }>).data.total).toBe(1);
    expect(
      (await get('notifications?page=999').expect(200)).body as Envelope<unknown>,
    ).toMatchObject({ data: { items: [], total: 2 } });
    await get('notifications?recipientUserId=someone').expect(400);
    await get('notifications?limit=101').expect(400);
    await get('notifications?unreadOnly=invalid').expect(400);
  });

  it('rolls back notifications with the business transaction and deduplicates concurrent replay', async () => {
    const before = await db.notification.count();
    await expect(
      db.$transaction(async (tx) => {
        await app.get(NotificationsService).record(tx, {
          eventKey: 'rollback',
          actorId: ids.manager,
          type: 'ANNOUNCEMENT',
          title: 'Rollback',
          body: 'Rollback',
          targetKind: 'CLASS',
          targetId: ids.classA,
          recipients: [{ userId: ids.parent }],
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await db.notification.count()).toBe(before);
    await Promise.all([notify('same-event'), notify('same-event')]);
    expect(await db.notification.count()).toBe(before + 1);
    const row = await db.notification.findFirstOrThrow({
      where: { recipientUserId: ids.parent },
      orderBy: { createdAt: 'desc' },
    });
    expect(
      await db.notificationDispatch.count({
        where: { payload: { path: '$.notificationId', equals: row.id } },
      }),
    ).toBe(1);
  });

  it('marks read idempotently and keeps new notifications unread after read-all', async () => {
    const row = await db.notification.findFirstOrThrow({ where: { recipientUserId: ids.parent } });
    const first = await http(token, 'patch', `notifications/${row.id}/read`).expect(200);
    const again = await http(token, 'patch', `notifications/${row.id}/read`).expect(200);
    expect((again.body as Envelope<{ readAt: string }>).data.readAt).toBe(
      (first.body as Envelope<{ readAt: string }>).data.readAt,
    );
    await http(token, 'post', 'notifications/read-all').expect(200);
    expect(
      (await get('notifications/unread-count').expect(200)).body as Envelope<unknown>,
    ).toMatchObject({ data: { unreadCount: 0 } });
    await notify('after-read-all');
    expect(
      (await get('notifications/unread-count').expect(200)).body as Envelope<unknown>,
    ).toMatchObject({ data: { unreadCount: 1 } });
  });

  it('authenticates sockets, emits within two seconds and synchronizes two devices', async () => {
    await app.get(NotificationsWorker).processDue();
    const one = await connect(token);
    const two = await connect(token);
    const foreign = await connect(await login('foreignParent'));
    const leaked = jest.fn();
    foreign.on('notification.created', leaked);
    const firstEvent = event<{ notificationId: string }>(one, 'notification.created');
    const secondEvent = event<{ notificationId: string }>(two, 'notification.created');
    const started = Date.now();
    app.get(NotificationsWorker).onModuleInit();
    await notify('socket-live');
    const [a, b] = await Promise.all([firstEvent, secondEvent]);
    expect(a).toEqual(b);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(leaked).not.toHaveBeenCalled();
    const changed = event(two, 'notifications.read-changed');
    await http(token, 'patch', `notifications/${a.notificationId}/read`).expect(200);
    await changed;
    expect(
      (await get('notifications?unreadOnly=true').expect(200)).body as Envelope<unknown>,
    ).not.toHaveProperty('data.items.0.recipientUserId');
    await app.get(NotificationsWorker).onModuleDestroy();
    one.disconnect();
    two.disconnect();
    foreign.disconnect();
    await expect(connect('invalid')).rejects.toThrow('AUTH_UNAUTHORIZED');
  });

  it('rejects refresh tokens and stops delivery after logout or account deactivation', async () => {
    const auth = await app.get(AuthService).login('parent@parent-mobile.test', 'ParentMobile123!');
    await expect(connect(auth.tokens.refreshToken)).rejects.toThrow('AUTH_UNAUTHORIZED');
    const client = await connect(auth.tokens.accessToken);
    const disconnected = event(client, 'disconnect');
    await http(auth.tokens.accessToken, 'post', 'auth/logout').expect(200);
    await notify('after-logout');
    await app.get(NotificationsWorker).processDue();
    await disconnected;
    const live = await connect(token);
    const disabled = event(live, 'disconnect');
    await db.user.update({ where: { id: ids.parent }, data: { status: 'DISABLED' } });
    await app
      .get(NotificationsGateway)
      .deliver(ids.parent, 'notification.created', { notificationId: 'never-delivered' });
    await disabled;
    await db.user.update({ where: { id: ids.parent }, data: { status: 'ACTIVE' } });
  });

  it('recovers an expired dispatch lease, retries a failed delivery and preserves the inbox', async () => {
    await notify('recover-lease');
    const row = await db.notificationDispatch.findFirstOrThrow({
      where: { status: 'PENDING', recipientUserId: ids.parent },
      orderBy: { createdAt: 'desc' },
    });
    await db.notificationDispatch.update({
      where: { id: row.id },
      data: { status: 'PROCESSING', leaseToken: 'dead-process', leaseExpiresAt: new Date(0) },
    });
    const gateway = app.get(NotificationsGateway);
    const failure = jest.spyOn(gateway, 'deliver').mockRejectedValueOnce(new Error('transient'));
    await app.get(NotificationsWorker).processDue();
    const retried = await db.notificationDispatch.findUniqueOrThrow({ where: { id: row.id } });
    expect(retried.attemptCount).toBeGreaterThan(0);
    failure.mockRestore();
    await db.notificationDispatch.update({
      where: { id: row.id },
      data: { status: 'PENDING', nextAttemptAt: new Date(0) },
    });
    await app.get(NotificationsWorker).processDue();
    expect(
      (await db.notificationDispatch.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe('SENT');
    expect(await db.notification.count({ where: { recipientUserId: ids.parent } })).toBeGreaterThan(
      0,
    );
  });

  it('publishes announcements once per parent with both children and excludes the author', async () => {
    const manager = await login('manager');
    const response = await http(manager, 'post', 'academic/announcements')
      .send({ classId: ids.classA, title: 'Lịch mới', content: 'Thông báo lớp' })
      .expect(201);
    const announcementId = (response.body as Envelope<{ id: string }>).data.id;
    const rows = await db.notification.findMany({
      where: { type: 'ANNOUNCEMENT', title: 'Lịch mới' },
    });
    expect(rows.filter((row) => row.recipientUserId === ids.parent)).toHaveLength(1);
    expect(rows.find((row) => row.recipientUserId === ids.parent)?.studentIds).toEqual(
      [ids.child, ids.sibling].sort(),
    );
    expect(rows.some((row) => row.recipientUserId === ids.teacher)).toBe(true);
    expect(rows.some((row) => row.recipientUserId === ids.manager)).toBe(false);
    expect(announcementId).toBeDefined();
  });

  it('notifies only the right child on published grades and never copies private grading content', async () => {
    const teacher = await login('teacher');
    const grade = await db.gradeReview.findFirstOrThrow({ where: { status: 'DRAFT' } });
    expect(await db.notification.count({ where: { type: 'GRADE_PUBLISHED' } })).toBe(0);
    await http(teacher, 'post', `academic/grades/${grade.id}/approve`).expect(201);
    await http(teacher, 'post', `academic/grades/${grade.id}/publish`).expect(201);
    const rows = await db.notification.findMany({ where: { type: 'GRADE_PUBLISHED' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].recipientUserId).toBe(ids.parent);
    expect(rows[0].studentIds).toEqual([ids.child]);
    expect(JSON.stringify(rows)).not.toContain('SECRET');
    await http(teacher, 'post', `academic/grades/${grade.id}/publish`).expect(409);
    expect(await db.notification.count({ where: { type: 'GRADE_PUBLISHED' } })).toBe(1);
  });

  it('resolves session recipients using actual seats, makeup participation, placement and term dates', async () => {
    const events = app.get(NotificationEventsService);
    await db.$transaction((tx) =>
      events.session(
        tx,
        ids.manager,
        ids.cancelledMakeup,
        'SESSION_RESCHEDULED',
        'Đổi lịch',
        'canceled-makeup-seat',
      ),
    );
    expect(
      await db.notification.count({
        where: { targetId: ids.cancelledMakeup, recipientUserId: ids.parent },
      }),
    ).toBe(0);
    await db.$transaction((tx) =>
      events.session(
        tx,
        ids.manager,
        ids.makeup,
        'SESSION_RESCHEDULED',
        'Đổi lịch',
        'active-makeup-seat',
      ),
    );
    expect(
      await db.notification.count({ where: { targetId: ids.makeup, recipientUserId: ids.parent } }),
    ).toBe(1);
    await db.enrollment.update({
      where: { id: ids.siblingEnrollment },
      data: { endDate: new Date('2021-01-01') },
    });
    await db.$transaction((tx) =>
      events.session(
        tx,
        ids.manager,
        ids.regular,
        'SESSION_RESCHEDULED',
        'Đổi lịch',
        'expired-enrollment',
      ),
    );
    const row = await db.notification.findFirstOrThrow({
      where: { targetId: ids.regular, recipientUserId: ids.parent, type: 'SESSION_RESCHEDULED' },
    });
    expect(row.studentIds).toEqual([ids.child]);
  });
  it('connects again after being offline and retrieves persisted notifications', async () => {
    const client = await connect(token);
    client.disconnect();
    await notify('while-offline');
    await app.get(NotificationsWorker).processDue();
    const reconnected = await connect(token);
    const rows = (await get('notifications').expect(200)).body as Envelope<{
      items: Array<{ body: string }>;
    }>;
    expect(rows.data.items.length).toBeGreaterThan(0);
    reconnected.disconnect();
  });

  it('notifies a teacher for a new submission and parents when an assignment is published', async () => {
    const teacher = await login('teacher');
    const created = await http(teacher, 'post', 'academic/assignments')
      .send({
        classId: ids.classA,
        title: 'Bài mới',
        instructions: 'Chọn đáp án',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        maxAttempts: 2,
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
    const assignment = (created.body as Envelope<{ id: string; questions: Array<{ id: string }> }>)
      .data;
    await http(teacher, 'post', `academic/assignments/${assignment.id}/publish`)
      .send({ enrollmentIds: [ids.childEnrollment] })
      .expect(201);
    expect(
      await db.notification.count({
        where: {
          type: 'ASSIGNMENT_PUBLISHED',
          recipientUserId: ids.parent,
          targetId: assignment.id,
        },
      }),
    ).toBe(1);
    const recipient = await db.assignmentRecipient.findFirstOrThrow({
      where: { assignmentId: assignment.id },
    });
    const submission = await http(token, 'post', 'academic/submissions')
      .send({
        recipientId: recipient.id,
        answers: [{ questionId: assignment.questions[0].id, answer: '2' }],
      })
      .expect(201);
    const submissionId = (submission.body as Envelope<{ id: string }>).data.id;
    expect(
      await db.notification.count({
        where: {
          type: 'SUBMISSION_RECEIVED',
          targetId: submissionId,
          recipientUserId: ids.teacher,
        },
      }),
    ).toBe(1);
    expect(
      await db.notification.count({
        where: { type: 'SUBMISSION_RECEIVED', targetId: submissionId, recipientUserId: ids.parent },
      }),
    ).toBe(0);
  });

  it('creates staff work items for leave and notifies parents only after a decision', async () => {
    const response = await http(token, 'post', 'academic/leaves')
      .send({
        enrollmentId: ids.childEnrollment,
        sessionId: ids.regular,
        kind: 'SINGLE_ABSENCE',
        fromDate: '2027-03-01',
        toDate: '2027-03-01',
        reason: 'Có việc gia đình',
      })
      .expect(201);
    const id = (response.body as Envelope<{ id: string }>).data.id;
    expect(
      await db.notification.count({
        where: { type: 'LEAVE_REQUESTED', targetId: id, recipientUserId: ids.staff },
      }),
    ).toBe(1);
    expect(
      await db.notification.count({
        where: { type: 'LEAVE_REQUESTED', targetId: id, recipientUserId: ids.parent },
      }),
    ).toBe(0);
    await http(await login('staff'), 'post', `academic/leaves/${id}/decide`)
      .send({ approve: true, reason: 'Đồng ý' })
      .expect(201);
    expect(
      await db.notification.count({
        where: { type: 'LEAVE_APPROVED', targetId: id, recipientUserId: ids.parent },
      }),
    ).toBe(1);
    expect(
      await db.notification.count({
        where: { type: 'LEAVE_APPROVED', targetId: id, recipientUserId: ids.teacher },
      }),
    ).toBe(1);
  });

  it('notifies makeup booking and cancellation using the target teacher and child context', async () => {
    const staff = await login('staff');
    await http(staff, 'post', `academic/makeups/${ids.booking}/cancel`).expect(201);
    const target = await db.classSession.create({
      data: {
        classId: ids.classB,
        lessonId: ids.lesson,
        teacherId: ids.teacher,
        startsAt: new Date('2027-03-15T10:00:00Z'),
        endsAt: new Date('2027-03-15T11:00:00Z'),
      },
    });
    const response = await http(staff, 'post', 'academic/makeups')
      .send({ originalParticipantId: ids.absentParticipant, targetSessionId: target.id })
      .expect(201);
    const id = (response.body as Envelope<{ id: string }>).data.id;
    const booked = await db.notification.findMany({
      where: { type: 'MAKEUP_BOOKED', targetId: id },
    });
    expect(booked.map((row) => row.recipientUserId).sort()).toEqual(
      [ids.parent, ids.teacher].sort(),
    );
    expect(
      booked.every((row) => JSON.stringify(row.studentIds) === JSON.stringify([ids.child])),
    ).toBe(true);
    await http(staff, 'post', `academic/makeups/${id}/cancel`).expect(201);
    expect(await db.notification.count({ where: { type: 'MAKEUP_CANCELLED', targetId: id } })).toBe(
      2,
    );
  });

  it('notifies every finalized attendance result without copying the teacher summary', async () => {
    const session = await db.classSession.create({
      data: {
        classId: ids.classA,
        lessonId: ids.lesson,
        teacherId: ids.teacher,
        startsAt: new Date(Date.now() - 7200000),
        endsAt: new Date(Date.now() - 3600000),
      },
    });
    const participant = await db.sessionParticipant.create({
      data: { sessionId: session.id, enrollmentId: ids.childEnrollment },
    });
    await http(
      await login('teacher'),
      'post',
      `academic/sessions/${session.id}/finalize-attendance`,
    )
      .send({
        items: [{ participantId: participant.id, status: 'PRESENT' }],
        summary: 'PRIVATE TEACHER SUMMARY',
      })
      .expect(201);
    const rows = await db.notification.findMany({
      where: { type: 'ATTENDANCE_FINALIZED', targetId: session.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].recipientUserId).toBe(ids.parent);
    expect(rows[0].body).toContain('có mặt');
    expect(rows[0].body).not.toContain('PRIVATE');
  });

  it('notifies pending teacher changes once, cancellation includes both teachers', async () => {
    const teacher = await db.user.create({
      data: {
        email: 'replacement@notifications.test',
        role: 'TEACHER',
        displayName: 'Replacement',
      },
    });
    const manager = await login('manager');
    const body = {
      teacherId: teacher.id,
      effectiveAt: new Date(Date.now() + 60000).toISOString(),
      reason: 'Đổi giáo viên',
    };
    await http(manager, 'post', `classes/${ids.classA}/teacher-assignments`).send(body).expect(201);
    const where = { type: 'TEACHER_CHANGED', targetId: ids.classA };
    const count = await db.notification.count({ where });
    expect(count).toBeGreaterThan(1);
    await http(manager, 'post', `classes/${ids.classA}/teacher-assignments`).send(body).expect(201);
    expect(await db.notification.count({ where })).toBe(count);
    await http(manager, 'post', `classes/${ids.classA}/teacher-assignments`)
      .send({ ...body, teacherId: ids.teacher })
      .expect(201);
    expect(await db.notification.count({ where: { ...where, recipientUserId: teacher.id } })).toBe(
      2,
    );
    expect(await db.notification.count({ where: { ...where, recipientUserId: ids.teacher } })).toBe(
      2,
    );
  });

  it('notifies feedback owners and submitters without broadcasting lesson contents', async () => {
    const created = await http(
      await login('teacher'),
      'post',
      `academic/lessons/${ids.lesson}/feedback`,
    )
      .send({ content: 'Cần chỉnh sửa' })
      .expect(201);
    const id = (created.body as Envelope<{ id: string }>).data.id;
    expect(
      await db.notification.count({
        where: { type: 'FEEDBACK_CREATED', targetId: id, recipientUserId: ids.designer },
      }),
    ).toBe(1);
    await http(await login('designer'), 'post', `academic/feedback/${id}/resolve`)
      .send({ status: 'RESOLVED', response: 'Đã xử lý' })
      .expect(201);
    expect(
      await db.notification.count({
        where: { type: 'FEEDBACK_RESOLVED', targetId: id, recipientUserId: ids.teacher },
      }),
    ).toBe(1);
    expect(
      JSON.stringify(await db.notification.findMany({ where: { targetId: id } })),
    ).not.toContain('SECRET');
  });

  it('records a room change atomically and prevents duplicate notification on idempotent replay', async () => {
    const room = await db.room.create({ data: { name: 'Replacement room', capacity: 20 } });
    const classroom = await db.class.create({
      data: {
        name: 'Room change class',
        programId: ids.program,
        teacherId: ids.teacher,
        capacity: 10,
        monthlyFee: 500000,
      },
    });
    const lesson = await db.lesson.create({
      data: {
        programId: ids.program,
        designerId: ids.designer,
        title: 'Room lesson',
        content: 'SECRET',
        sequence: 99,
        status: 'APPROVED',
      },
    });
    const startsAt = new Date(Date.now() + 172800000).toISOString();
    const endsAt = new Date(Date.now() + 176400000).toISOString();
    const session = await db.classSession.create({
      data: {
        classId: classroom.id,
        lessonId: lesson.id,
        teacherId: ids.teacher,
        startsAt,
        endsAt,
      },
    });
    const manager = await login('manager');
    const body = { startsAt, endsAt, roomId: room.id, expectedRevision: 1, reason: 'Đổi phòng' };
    const send = (): request.Test =>
      http(manager, 'post', `academic/sessions/${session.id}/reschedule`)
        .set('Idempotency-Key', 'room-change')
        .send(body);
    await send().expect(201);
    await send().expect(201);
    expect((await db.classSession.findUniqueOrThrow({ where: { id: session.id } })).roomId).toBe(
      room.id,
    );
    expect(
      await db.notification.count({
        where: { type: 'SESSION_RESCHEDULED', targetId: session.id, recipientUserId: ids.teacher },
      }),
    ).toBe(1);
  });

  it('rejects expired credentials and closes a live socket at token expiry', async () => {
    const session = await db.authSession.findFirstOrThrow({
      where: { userId: ids.parent, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const config = app.get(ConfigService<AppConfiguration, true>).get('jwt', { infer: true });
    const sign = (expiresIn: number): Promise<string> =>
      app.get(JwtService).signAsync(
        { sub: ids.parent, sid: session.id, role: 'PARENT', type: 'access' },
        {
          secret: config.accessSecret,
          issuer: config.issuer,
          audience: config.audience,
          algorithm: 'HS256',
          expiresIn,
        },
      );
    await expect(connect(await sign(-1))).rejects.toThrow('AUTH_UNAUTHORIZED');
    const client = await connect(await sign(2));
    await event(client, 'disconnect');
    expect(client.connected).toBe(false);
  });

  it('stops retrying exhausted dispatches without removing persisted notifications', async () => {
    await app.get(NotificationsWorker).processDue();
    await notify('exhausted-delivery');
    const row = await db.notificationDispatch.findFirstOrThrow({
      where: { status: 'PENDING', recipientUserId: ids.parent },
    });
    await db.notificationDispatch.update({ where: { id: row.id }, data: { attemptCount: 5 } });
    await app.get(NotificationsWorker).processDue();
    expect(
      (await db.notificationDispatch.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe('FAILED');
    expect((await get('notifications').expect(200)).status).toBe(200);
  });

  it('keeps the last placement teacher when ending an enrollment after transfer', async () => {
    const otherTeacher = await db.user.create({
      data: { email: 'last-placement@notifications.test', role: 'TEACHER' },
    });
    const classroom = await db.class.create({
      data: {
        name: 'Last placement',
        programId: ids.program,
        teacherId: otherTeacher.id,
        capacity: 20,
        monthlyFee: 500000,
      },
    });
    await db.enrollmentPlacement.create({
      data: {
        enrollmentId: ids.siblingEnrollment,
        classId: classroom.id,
        effectiveFrom: new Date('2020-01-01'),
        effectiveTo: new Date('2021-01-01'),
      },
    });
    await db.enrollment.update({
      where: { id: ids.siblingEnrollment },
      data: { status: 'ENDED', endedAt: new Date('2021-01-01') },
    });
    await db.$transaction((tx) =>
      app
        .get(NotificationEventsService)
        .workflow(
          tx,
          ids.staff,
          ids.siblingEnrollment,
          'ENROLLMENT_ENDED',
          ids.siblingEnrollment,
          'Đã kết thúc ghi danh.',
        ),
    );
    expect(
      await db.notification.count({
        where: {
          type: 'ENROLLMENT_ENDED',
          targetId: ids.siblingEnrollment,
          recipientUserId: otherTeacher.id,
        },
      }),
    ).toBe(1);
    expect(
      await db.notification.count({
        where: {
          type: 'ENROLLMENT_ENDED',
          targetId: ids.siblingEnrollment,
          recipientUserId: ids.teacher,
        },
      }),
    ).toBe(0);
  });
  it('distinguishes repeated valid makeup moves from a replay of the same event', async () => {
    const targets = [];
    for (const day of [16, 17]) {
      targets.push(
        await db.classSession.create({
          data: {
            classId: ids.classB,
            lessonId: ids.lesson,
            teacherId: ids.teacher,
            startsAt: new Date(`2027-03-${day}T10:00:00Z`),
            endsAt: new Date(`2027-03-${day}T11:00:00Z`),
          },
        }),
      );
    }
    const staff = await login('staff');
    const booked = await http(staff, 'post', 'academic/makeups')
      .send({ originalParticipantId: ids.absentParticipant, targetSessionId: targets[0].id })
      .expect(201);
    const id = (booked.body as Envelope<{ id: string }>).data.id;
    for (const target of [targets[1], targets[0], targets[1]]) {
      await http(staff, 'post', `academic/makeups/${id}/reschedule`)
        .send({ targetSessionId: target.id, reason: 'Đổi lịch học bù' })
        .expect(201);
    }
    expect(
      await db.notification.count({
        where: { type: 'MAKEUP_RESCHEDULED', targetId: id, recipientUserId: ids.parent },
      }),
    ).toBe(3);
    expect(
      await db.notification.count({
        where: { type: 'MAKEUP_RESCHEDULED', targetId: id, recipientUserId: ids.teacher },
      }),
    ).toBe(3);
  });
});
