import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import * as bcrypt from 'bcrypt';
import * as mysql from 'mysql2/promise';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { validateEnvironment } from '../../src/config/configuration';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { DatabaseService } from '../../src/database/orm/database.service';
import { seedDemo } from '../../src/database/seeds/seed-demo';
import { BULK_PREFIX, seedDashboard } from '../../src/database/seeds/seed-dashboard';
import {
  addDays,
  dateOnly,
  localInstant,
  monthStart,
  referenceDate,
  studyDay,
} from '../../src/database/seeds/seed-calendar';
import { AuthService } from '../../src/modules/auth/auth.service';
import { EmailDeliveriesService } from '../../src/modules/academic/email-deliveries.service';
import { GradingWorkerService } from '../../src/modules/academic/grading-worker.service';

const source = new URL(
  process.env.ACADEMIC_TEST_DATABASE_URL ?? 'mysql://root:admin123@localhost:3307',
);
const dbName = `edugrade_dashboard_test_${process.pid}_${Date.now()}`;
const dbUrl = new URL(source);
dbUrl.pathname = `/${dbName}`;
const password = 'DashboardSeed123!';
const today = referenceDate();
// Mid-afternoon keeps both finished and upcoming sessions on the reference date.
const now = localInstant(today, 15, 30);
const monthFrom = dateOnly(monthStart(today));
const monthTo = dateOnly(addDays(monthStart(today, 1), -1));

interface Envelope<T> {
  data: T;
}

/** Same grouping as the manager dashboard activity chart. */
function activityCategory(action: string): string {
  if (action === 'REGISTRATION_CONFIRM_PAYMENT') return 'tuition';
  if (action.startsWith('REGISTRATION_')) return 'registration';
  if (action.startsWith('LEAVE_') || action === 'STUDENT_END_STUDY') return 'leave';
  if (action === 'SESSION_SUBSTITUTE_ASSIGNED') return 'substitute';
  return 'other';
}

describe('Dashboard seed on top of the demo dataset', () => {
  let app: INestApplication;
  let server: Server;
  let db: DatabaseService;
  let connection: mysql.Connection;
  let manager: string;
  let staff: string;

  beforeAll(async () => {
    connection = await mysql.createConnection({
      host: source.hostname,
      port: Number(source.port || 3306),
      user: decodeURIComponent(source.username),
      password: decodeURIComponent(source.password),
    });
    await connection.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [
      dbName,
    ]);
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: dbUrl.toString(),
      CORS_ORIGINS: 'http://localhost:3000',
      SWAGGER_ENABLED: 'false',
      JWT_ACCESS_SECRET: 'dashboard-seed-access-secret-at-least-32-chars',
      JWT_REFRESH_SECRET: 'dashboard-seed-refresh-secret-at-least-32-chars',
      THROTTLE_LIMIT_PER_MINUTE: '10000',
      AI_CHAT_URL: '',
      AI_API_KEY: '',
      AI_MODEL: '',
      MAIL_HOST: '',
    };
    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      { env, stdio: 'pipe' },
    );
    Object.assign(process.env, env);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(validateEnvironment(env)))
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
    app.get(EmailDeliveriesService).onModuleDestroy();
    await app.get(GradingWorkerService).onModuleDestroy();
    server = app.getHttpServer() as Server;
    db = app.get(DatabaseService);
    const hash = await bcrypt.hash(password, 4);
    await seedDemo(db, hash, dateOnly(today), {});
    const result = await seedDashboard(db, hash, { now });
    expect(result.created).toBe(true);
    const auth = app.get(AuthService);
    manager = (await auth.login('manager@edugrade.local', password)).tokens.accessToken;
    staff = (await auth.login('staff@edugrade.local', password)).tokens.accessToken;
  }, 600_000);

  afterAll(async () => {
    if (app) await app.close();
    if (connection) {
      await connection.query('DROP DATABASE IF EXISTS ??', [dbName]);
      await connection.end();
    }
  });

  const get = async <T>(path: string, token = manager): Promise<T> =>
    (
      (
        await request(server)
          .get(`/api/v1/${path}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body as Envelope<T>
    ).data;

  it('creates enough people, classes and history for every dashboard widget', async () => {
    expect(
      await db.user.count({ where: { role: 'TEACHER', status: 'ACTIVE' } }),
    ).toBeGreaterThanOrEqual(45);
    expect(await db.studentProfile.count({ where: { status: 'ACTIVE' } })).toBeGreaterThanOrEqual(
      300,
    );
    expect(
      await db.class.count({ where: { isOpen: true, isActive: true } }),
    ).toBeGreaterThanOrEqual(40);
    expect(await db.payment.count()).toBeGreaterThan(500);
    const grades = await db.studentProfile.groupBy({
      by: ['grade'],
      where: { status: 'ACTIVE' },
      _count: true,
    });
    expect(grades.map((row) => row.grade).sort()).toEqual([6, 7, 8, 9]);
    for (const row of grades) expect(row._count).toBeGreaterThan(40);
  });

  it('keeps orders, payments, participants, makeups and grades consistent', async () => {
    const orders = await db.registrationOrder.findMany({
      include: { payment: true, enrollment: { include: { placements: true } } },
    });
    for (const order of orders) {
      if (order.status === 'COMPLETED') {
        expect(order.payment?.amount.toString()).toBe(order.quotedAmount.toString());
        expect(order.enrollment?.studentProfileId).toBe(order.targetStudentId);
        expect(order.enrollment?.placements.length).toBeGreaterThan(0);
      } else {
        expect(order.payment).toBeNull();
        expect(order.enrollment).toBeNull();
      }
    }
    const participants = await db.sessionParticipant.findMany({
      include: { session: true, enrollment: { include: { placements: true } } },
    });
    for (const participant of participants) {
      const day = studyDay(participant.session.startsAt);
      expect(
        day >= participant.enrollment.startDate! && day < participant.enrollment.endDate!,
      ).toBe(true);
      if (participant.kind === 'REGULAR')
        expect(
          participant.enrollment.placements.some(
            (placement) =>
              placement.classId === participant.session.classId &&
              placement.effectiveFrom <= participant.session.startsAt &&
              (!placement.effectiveTo || placement.effectiveTo > participant.session.startsAt),
          ),
        ).toBe(true);
      if (participant.session.status === 'COMPLETED')
        expect(participant.attendance).not.toBe('UNMARKED');
      if (participant.id.startsWith(BULK_PREFIX)) {
        expect(participant.session.status).not.toBe('CANCELLED');
        if (participant.enrollment.endedAt)
          expect(participant.session.startsAt < participant.enrollment.endedAt).toBe(true);
      }
    }
    const bookings = await db.makeupBooking.findMany({
      include: {
        original: { include: { session: true } },
        replacement: { include: { session: true } },
      },
    });
    expect(bookings.filter((booking) => booking.id.startsWith(BULK_PREFIX)).length).toBeGreaterThan(
      10,
    );
    for (const booking of bookings) {
      expect(booking.original.session.lessonId).toBe(booking.replacement.session.lessonId);
      expect(booking.replacement.kind).toBe('MAKEUP');
      expect(booking.original.enrollmentId).toBe(booking.replacement.enrollmentId);
    }
    const reviews = await db.gradeReview.findMany({
      include: {
        submission: {
          include: { recipient: { include: { assignment: { include: { questions: true } } } } },
        },
      },
    });
    for (const review of reviews) {
      const scores = review.scores as { questionId: string; score: number }[];
      expect(scores.reduce((sum, score) => sum + score.score, 0)).toBe(review.totalScore);
      for (const question of review.submission.recipient.assignment.questions) {
        const score = scores.find((value) => value.questionId === question.id)!;
        expect(score.score).toBeGreaterThanOrEqual(0);
        expect(score.score).toBeLessThanOrEqual(question.maxScore);
      }
    }
    expect(
      await db.outboxEvent.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
    ).toBe(0);
  });

  it('respects seats, schedules, leave rules and the seeding instant', async () => {
    const sessions = await db.classSession.findMany({
      where: { status: { not: 'CANCELLED' } },
      include: {
        class: { select: { capacity: true } },
        participants: { where: { cancelled: false, attendance: { not: 'EXCUSED' } } },
      },
      orderBy: { startsAt: 'asc' },
    });
    for (let index = 0; index < sessions.length; index++) {
      const current = sessions[index];
      expect(current.participants.length).toBeLessThanOrEqual(current.class.capacity);
      if (current.id.startsWith(BULK_PREFIX) && current.status === 'COMPLETED')
        expect(current.endsAt <= now).toBe(true);
      for (
        let next = index + 1;
        next < sessions.length && sessions[next].startsAt < current.endsAt;
        next++
      ) {
        expect(sessions[next].teacherId).not.toBe(current.teacherId);
        if (current.roomId) expect(sessions[next].roomId).not.toBe(current.roomId);
      }
    }
    const byStudent = new Map<string, { startsAt: Date; endsAt: Date }[]>();
    for (const participant of await db.sessionParticipant.findMany({
      where: { cancelled: false, session: { status: { not: 'CANCELLED' } } },
      select: {
        session: { select: { startsAt: true, endsAt: true } },
        enrollment: { select: { studentProfileId: true } },
      },
    })) {
      const key = participant.enrollment.studentProfileId!;
      byStudent.set(key, [...(byStudent.get(key) ?? []), participant.session]);
    }
    for (const busy of byStudent.values()) {
      busy.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      for (let index = 1; index < busy.length; index++)
        expect(busy[index].startsAt >= busy[index - 1].endsAt).toBe(true);
    }
    const leaves = await db.leaveRequest.findMany({ include: { enrollment: true } });
    const approved = new Map<string, { fromDate: Date; toDate: Date }[]>();
    for (const leave of leaves) {
      expect(leave.fromDate >= leave.enrollment.startDate!).toBe(true);
      expect(leave.toDate < leave.enrollment.endDate!).toBe(true);
      if (leave.status !== 'APPROVED') continue;
      for (const other of approved.get(leave.enrollmentId) ?? [])
        expect(leave.fromDate > other.toDate || leave.toDate < other.fromDate).toBe(true);
      approved.set(leave.enrollmentId, [...(approved.get(leave.enrollmentId) ?? []), leave]);
    }
    const bulk = { id: { startsWith: BULK_PREFIX } };
    for (const count of await Promise.all([
      db.payment.count({ where: { ...bulk, confirmedAt: { gt: now } } }),
      db.auditLog.count({ where: { ...bulk, createdAt: { gt: now } } }),
      db.registrationOrder.count({ where: { ...bulk, createdAt: { gt: now } } }),
      db.submission.count({ where: { ...bulk, submittedAt: { gt: now } } }),
      db.gradeReview.count({ where: { ...bulk, createdAt: { gt: now } } }),
      db.leaveRequest.count({ where: { ...bulk, createdAt: { gt: now } } }),
      db.makeupBooking.count({ where: { ...bulk, createdAt: { gt: now } } }),
    ]))
      expect(count).toBe(0);
  });

  it('fills every manager dashboard widget through the API', async () => {
    const summary = await get<{
      tuition: { confirmedAmount: string; paymentCount: number };
      counts: { activeStudents: number; studyingStudents: number; activeTeachers: number };
    }>(`dashboard?fromDate=${monthFrom}&toDate=${monthTo}`);
    expect(Number(summary.tuition.confirmedAmount)).toBeGreaterThan(50_000_000);
    expect(summary.tuition.paymentCount).toBeGreaterThan(40);
    expect(summary.counts.studyingStudents).toBeGreaterThanOrEqual(250);
    expect(summary.counts.activeStudents).toBeGreaterThanOrEqual(summary.counts.studyingStudents);
    expect(summary.counts.activeTeachers).toBeGreaterThanOrEqual(45);

    const from = `${dateOnly(monthStart(today, -5))}T00:00:00.000+07:00`;
    const to = `${monthTo}T23:59:59.999+07:00`;
    const analytics = await get<{
      trend: { period: string; confirmedRevenue: number; completedSessions: number }[];
    }>(
      `academic/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucket=MONTH`,
    );
    expect(analytics.trend).toHaveLength(6);
    for (const point of analytics.trend.slice(0, 5)) {
      expect(point.confirmedRevenue).toBeGreaterThan(0);
      expect(point.completedSessions).toBeGreaterThan(0);
    }
    expect(analytics.trend[5].confirmedRevenue).toBeGreaterThan(0);

    const monthStartIso = `${monthFrom}T00:00:00.000+07:00`;
    const categories = new Map<string, number>();
    for (let page = 1; ; page++) {
      const logs = await get<{ items: { action: string }[]; total: number }>(
        `audit-logs?page=${page}&limit=100&from=${encodeURIComponent(monthStartIso)}&to=${encodeURIComponent(to)}`,
      );
      for (const item of logs.items)
        categories.set(
          activityCategory(item.action),
          (categories.get(activityCategory(item.action)) ?? 0) + 1,
        );
      if (page * 100 >= logs.total) break;
    }
    for (const category of ['tuition', 'registration', 'leave', 'substitute', 'other'])
      expect(categories.get(category) ?? 0).toBeGreaterThan(0);

    const todaySessions = await get<{ status: string }[]>(
      `academic/scheduled-sessions?fromDate=${dateOnly(today)}&toDate=${dateOnly(today)}&page=1&limit=100`,
    );
    expect(
      todaySessions.filter((session) => session.status !== 'CANCELLED').length,
    ).toBeGreaterThan(0);

    const students = await get<{ items: unknown[]; total: number; limit: number }>(
      'students?page=1&limit=100',
    );
    expect(students.total).toBeGreaterThanOrEqual(340);
    const classes = await get<{ isOpen: boolean; isActive: boolean }[]>('classes?page=1&limit=100');
    expect(classes.filter((item) => item.isOpen && item.isActive).length).toBeGreaterThanOrEqual(
      40,
    );

    const exported = await request(server)
      .get(
        `/api/v1/academic/analytics/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucket=MONTH`,
      )
      .set('Authorization', `Bearer ${manager}`)
      .buffer(true)
      .expect(200);
    expect(String(exported.headers['content-type'])).toContain('spreadsheetml');
  });

  it('lets staff, teachers and parents work with the bulk rows', async () => {
    const draft = await db.registrationOrder.findFirstOrThrow({
      where: { id: { startsWith: BULK_PREFIX }, status: 'DRAFT' },
      orderBy: { startDate: 'asc' },
    });
    await request(server)
      .post(`/api/v1/registrations/${draft.id}/confirm-payment`)
      .set('Authorization', `Bearer ${staff}`)
      .set('Idempotency-Key', 'dashboard-seed-confirm-draft')
      .send({ receiptNumber: 'DASHBOARD-SEED-RECEIPT' })
      .expect(201);
    const pending = await db.leaveRequest.findFirstOrThrow({
      where: { id: { startsWith: BULK_PREFIX }, status: 'PENDING', kind: 'SINGLE_ABSENCE' },
    });
    await request(server)
      .post(`/api/v1/academic/leaves/${pending.id}/decide`)
      .set('Authorization', `Bearer ${staff}`)
      .send({ approve: true, reason: 'Đã liên hệ phụ huynh.' })
      .expect(201);

    const auth = app.get(AuthService);
    const teacherAccount = await db.user.findFirstOrThrow({
      where: {
        id: { startsWith: `${BULK_PREFIX}user_teacher_math` },
        teachingClasses: { some: {} },
      },
    });
    const teacher = (await auth.login(teacherAccount.email, password)).tokens.accessToken;
    const teacherClasses = await get<unknown[]>('classes?page=1&limit=100', teacher);
    expect(teacherClasses.length).toBeGreaterThan(0);
    await get<unknown[]>(
      `academic/scheduled-sessions?fromDate=${dateOnly(today)}&toDate=${dateOnly(today)}&page=1&limit=100`,
      teacher,
    );

    const parentAccount = await db.user.findFirstOrThrow({
      where: {
        id: { startsWith: `${BULK_PREFIX}user_parent_` },
        parentProfile: { students: { some: { enrollments: { some: { status: 'ACTIVE' } } } } },
      },
    });
    const parent = (await auth.login(parentAccount.email, password)).tokens.accessToken;
    const children = await get<unknown[]>('me/students', parent);
    expect(children.length).toBeGreaterThan(0);
  });

  it('runs only once', async () => {
    const before = await Promise.all([
      db.user.count(),
      db.registrationOrder.count(),
      db.classSession.count(),
      db.sessionParticipant.count(),
      db.auditLog.count(),
    ]);
    const again = await seedDashboard(db, 'unused-hash', { now });
    expect(again.created).toBe(false);
    expect(
      await Promise.all([
        db.user.count(),
        db.registrationOrder.count(),
        db.classSession.count(),
        db.sessionParticipant.count(),
        db.auditLog.count(),
      ]),
    ).toEqual(before);
  });
});
