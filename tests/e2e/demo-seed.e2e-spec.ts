import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
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
import {
  addDays,
  dateOnly,
  demoId,
  referenceDate,
  studyDay,
} from '../../src/database/seeds/seed-calendar';
import { slotsForRange } from '../../src/modules/curriculum-scheduling/curriculum-scheduling.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { EmailDeliveriesService } from '../../src/modules/academic/email-deliveries.service';
import { GradingWorkerService } from '../../src/modules/academic/grading-worker.service';

const source = new URL(
  process.env.ACADEMIC_TEST_DATABASE_URL ?? 'mysql://root:admin123@localhost:3307',
);
const dbName = `edugrade_seed_test_${process.pid}_${Date.now()}`;
const dbUrl = new URL(source);
dbUrl.pathname = `/${dbName}`;
const password = 'SeedIntegration123!';
const today = referenceDate();

describe('Demo seed against MySQL and shared APIs', () => {
  let app: INestApplication;
  let server: Server;
  let db: DatabaseService;
  let connection: mysql.Connection;

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
      JWT_ACCESS_SECRET: 'seed-test-access-secret-at-least-32-characters',
      JWT_REFRESH_SECRET: 'seed-test-refresh-secret-at-least-32-characters',
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
    await seedDemo(db, await bcrypt.hash(password, 4), dateOnly(today), {});
  }, 120_000);

  afterAll(async () => {
    if (app) await app.close();
    if (connection) {
      await connection.query('DROP DATABASE IF EXISTS ??', [dbName]);
      await connection.end();
    }
  });

  it('covers four subjects and all grades with enough approved shared curriculum', async () => {
    expect(await db.subject.count()).toBe(4);
    expect(await db.program.count()).toBe(16);
    expect(await db.studentProfile.count()).toBe(14);
    const classes = await db.class.findMany({
      where: { teacherId: { not: null }, isActive: true },
      include: { weeklySchedules: true },
    });
    for (const classroom of classes) {
      const unit = await db.curriculumUnit.findFirstOrThrow({
        where: { programId: classroom.programId, status: 'APPROVED' },
        include: { lessons: true },
      });
      const slots = slotsForRange(
        classroom.weeklySchedules,
        dateOnly(unit.fromDate),
        dateOnly(unit.toDate),
      );
      const lessons = unit.lessons
        .filter((lesson) => lesson.kind === 'LESSON')
        .sort((a, b) => a.sequence - b.sequence);
      expect(lessons.length).toBeGreaterThanOrEqual(slots.length);
      expect(lessons.map((lesson) => lesson.sequence)).toEqual(
        Array.from({ length: lessons.length }, (_, index) => index + 1),
      );
      expect(unit.lessons.filter((lesson) => lesson.kind === 'MONTHLY_TEST')).toHaveLength(0);
      expect(unit.reviewerTeacherId).not.toBeNull();
      expect(unit.technicalReviewedAt).not.toBeNull();
      expect(
        unit.lessons.every(
          (lesson) => lesson.status === 'APPROVED' && !lesson.content.includes('CHƯA ĐIỀN'),
        ),
      ).toBe(true);
    }
  });

  it('exposes 48 sourced CLO drafts for math, chemistry and biology without claiming approval', async () => {
    expect(await db.outcomeSet.count()).toBe(12);
    expect(await db.learningOutcome.count()).toBe(48);
    expect(await db.outcomeSet.count({ where: { status: 'APPROVED' } })).toBe(0);
    expect(await db.learningOutcome.count({ where: { sourceStatus: 'VERIFIED' } })).toBe(0);
    const auth = app.get(AuthService);
    const manager = (await auth.login('manager@edugrade.local', password)).tokens.accessToken;
    const parent = (await auth.login('parent@edugrade.local', password)).tokens.accessToken;
    const url = `/api/v1/academic/programs/${demoId('program_math-8')}/outcome-sets`;
    const managerResponse = await request(server)
      .get(url)
      .set('Authorization', `Bearer ${manager}`)
      .expect(200);
    const managerData = (managerResponse.body as { data: Array<{ outcomes: unknown[] }> }).data;
    expect(managerData).toHaveLength(1);
    expect(managerData[0].outcomes).toHaveLength(4);
    const parentResponse = await request(server)
      .get(url)
      .set('Authorization', `Bearer ${parent}`)
      .expect(200);
    const parentData = (parentResponse.body as { data: unknown[] }).data;
    expect(parentData).toEqual([]);
  });

  it('paginates and filters list APIs while keeping role scope and totals', async () => {
    const auth = app.get(AuthService);
    const tokens = {
      manager: (await auth.login('manager@edugrade.local', password)).tokens.accessToken,
      teacher: (await auth.login('teacher@edugrade.local', password)).tokens.accessToken,
      parent: (await auth.login('parent@edugrade.local', password)).tokens.accessToken,
      staff: (await auth.login('staff@edugrade.local', password)).tokens.accessToken,
    };
    const classId = demoId('class_math-8-a');
    const programId = demoId('program_math-8');
    const studentId = demoId('student_an');
    const session = await db.classSession.findFirstOrThrow({ where: { classId } });
    const assignment = await db.assignment.findFirstOrThrow({ where: { classId } });
    const cases: Array<[keyof typeof tokens, string, Record<string, string | number | boolean>]> = [
      ['manager', 'subjects', { search: 'Toán' }],
      ['manager', 'programs', { grade: 8 }],
      ['manager', 'rooms', { isActive: false }],
      ['manager', 'classes', { programId }],
      ['manager', 'academic/programs', { grade: 8 }],
      ['manager', 'academic/classes', { programId }],
      ['manager', 'academic/lessons', { programId }],
      ['manager', 'academic/sessions', { classId }],
      ['manager', 'academic/enrollments', { classId }],
      ['manager', `academic/sessions/${session.id}/roster`, { attendance: 'PRESENT' }],
      ['manager', 'academic/feedback', { status: 'OPEN' }],
      ['manager', 'academic/announcements', { classId }],
      ['teacher', 'academic/reports', { classId }],
      ['teacher', 'academic/assignments', { classId }],
      ['teacher', `academic/assignments/${assignment.id}/submissions`, {}],
      ['manager', 'academic/makeups', { status: 'BOOKED' }],
      ['manager', 'academic/makeup-sources', { completedOnly: true }],
      ['manager', 'academic/leaves', { classId }],
      ['manager', 'academic/curriculum-units', { grade: 8 }],
      ['manager', 'academic/scheduled-sessions', { classId }],
      ['manager', `academic/programs/${programId}/outcome-sets`, { status: 'DRAFT' }],
      ['manager', `academic/classes/${classId}/session-generations`, {}],
      ['manager', `academic/curriculum-units/${demoId('unit_math-8_v2')}/reviewers`, {}],
      ['manager', 'staff', { status: 'ACTIVE' }],
      ['manager', 'teachers', { search: 'teacher' }],
      ['manager', 'curriculum-designers', { status: 'ACTIVE' }],
      ['manager', 'parents', { status: 'ACTIVE' }],
      ['manager', 'managers', { status: 'ACTIVE' }],
      ['manager', 'teacher-invitations', { status: 'INVITED' }],
      ['manager', 'manager-invitations', { status: 'ACCEPTED' }],
      ['manager', 'audit-logs', {}],
      ['manager', 'registrations', { status: 'DRAFT' }],
      ['manager', 'payments', {}],
      ['manager', 'students', { grade: 8 }],
      ['parent', 'me/bills', {}],
      ['parent', 'me/students', { grade: 8 }],
      ['parent', `me/students/${studentId}/enrollments`, {}],
      ['parent', `me/students/${studentId}/schedule`, {}],
      ['manager', `students/${studentId}/enrollments`, {}],
      ['manager', `students/${studentId}/schedule`, {}],
      ['manager', `classes/${classId}/schedules`, {}],
      ['manager', `academic/students/${studentId}/grades`, {}],
      ['parent', `academic/me/students/${studentId}/curriculum`, {}],
      ['manager', 'academic/email-deliveries', { status: 'PENDING' }],
      ['parent', 'notifications', { unreadOnly: true }],
      ['staff', 'parents/search', { email: 'parent' }],
    ];
    for (const [role, path, filters] of cases) {
      const response = await request(server).get(`/api/v1/${path}`)
        .query({ paginated: true, page: 1, limit: 1, ...filters })
        .set('Authorization', `Bearer ${tokens[role]}`);
      expect({ path, status: response.status, body: response.body as unknown }).toMatchObject({ path, status: 200 });
      const data = (response.body as { data: { items: unknown[]; total: number; page: number; limit: number } }).data;
      expect({ path, page: data.page, limit: data.limit }).toEqual({ path, page: 1, limit: 1 });
      expect(Array.isArray(data.items)).toBe(true);
      expect(data.items.length).toBeLessThanOrEqual(1);
      expect(data.total).toBeGreaterThanOrEqual(data.items.length);
    }
    const lessonsUrl = `/api/v1/academic/lessons?programId=${programId}&paginated=true&limit=1`;
    const first = await request(server).get(`${lessonsUrl}&page=1`).set('Authorization', `Bearer ${tokens.manager}`).expect(200);
    const second = await request(server).get(`${lessonsUrl}&page=2`).set('Authorization', `Bearer ${tokens.manager}`).expect(200);
    const firstData = (first.body as { data: { items: Array<{ id: string }>; total: number } }).data;
    const secondData = (second.body as { data: { items: Array<{ id: string }>; total: number } }).data;
    expect(firstData.total).toBe(secondData.total);
    expect(firstData.items[0].id).not.toBe(secondData.items[0].id);
    const empty = await request(server).get('/api/v1/academic/assignments')
      .query({ paginated: true, status: 'DRAFT' }).set('Authorization', `Bearer ${tokens.parent}`).expect(200);
    expect((empty.body as { data: { total: number } }).data.total).toBe(0);
    await request(server).get('/api/v1/academic/assignments?status=INVALID').set('Authorization', `Bearer ${tokens.teacher}`).expect(400);
    await request(server).get('/api/v1/rooms?isActive=wrong').set('Authorization', `Bearer ${tokens.manager}`).expect(400);
    await request(server).get('/api/v1/academic/lessons?limit=101').set('Authorization', `Bearer ${tokens.manager}`).expect(400);
    await request(server).get('/api/v1/academic/sessions?fromDate=2026-10-25&toDate=2026-10-24').set('Authorization', `Bearer ${tokens.manager}`).expect(400);
  }, 120_000);

  it('keeps payment, placement, attendance, makeup and grade records consistent', async () => {
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
    }
    const bookings = await db.makeupBooking.findMany({
      include: {
        original: { include: { session: true } },
        replacement: { include: { session: true } },
      },
    });
    expect(bookings.map((booking) => booking.status).sort()).toEqual([
      'BOOKED',
      'CANCELLED',
      'COMPLETED',
      'MISSED',
    ]);
    for (const booking of bookings) {
      expect(booking.original.session.lessonId).toBe(booking.replacement.session.lessonId);
      expect(booking.replacement.kind).toBe('MAKEUP');
      expect(booking.original.enrollmentId).toBe(booking.replacement.enrollmentId);
    }
    const grades = await db.gradeReview.findMany({
      include: {
        submission: {
          include: { recipient: { include: { assignment: { include: { questions: true } } } } },
        },
      },
    });
    for (const grade of grades) {
      const scores = grade.scores as { questionId: string; score: number }[];
      expect(scores.reduce((sum, score) => sum + score.score, 0)).toBe(grade.totalScore);
      for (const question of grade.submission.recipient.assignment.questions) {
        const score = scores.find((value) => value.questionId === question.id)!;
        expect(score.score).toBeGreaterThanOrEqual(0);
        expect(score.score).toBeLessThanOrEqual(question.maxScore);
      }
    }
    expect(
      await db.outboxEvent.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
    ).toBe(0);
    expect(await db.gradingJob.count({ where: { status: { in: ['QUEUED', 'PROCESSING'] } } })).toBe(
      0,
    );
  });

  it('does not double-book teachers or rooms', async () => {
    const sessions = await db.classSession.findMany({
      where: { status: { not: 'CANCELLED' } },
      orderBy: { startsAt: 'asc' },
    });
    for (let index = 0; index < sessions.length; index++) {
      const current = sessions[index];
      for (
        let next = index + 1;
        next < sessions.length && sessions[next].startsAt < current.endsAt;
        next++
      ) {
        expect(sessions[next].teacherId).not.toBe(current.teacherId);
        if (current.roomId) expect(sessions[next].roomId).not.toBe(current.roomId);
      }
    }
  });

  it('supports login, parent data, manager statistics and an unpaid draft confirmation', async () => {
    const auth = app.get(AuthService);
    const manager = (await auth.login('manager@edugrade.local', password)).tokens.accessToken;
    const parent = (await auth.login('parent@edugrade.local', password)).tokens.accessToken;
    const staff = (await auth.login('staff@edugrade.local', password)).tokens.accessToken;
    await request(server)
      .get('/api/v1/me/students')
      .set('Authorization', `Bearer ${parent}`)
      .expect(200);
    const dashboard = await request(server)
      .get('/api/v1/dashboard')
      .query({ fromDate: dateOnly(addDays(today, -60)), toDate: dateOnly(today) })
      .set('Authorization', `Bearer ${manager}`)
      .expect(200);
    expect(
      Number(
        (dashboard.body as { data: { tuition: { confirmedAmount: string } } }).data.tuition
          .confirmedAmount,
      ),
    ).toBeGreaterThan(0);
    await request(server)
      .post(`/api/v1/registrations/${demoId('order_thai-draft')}/confirm-payment`)
      .set('Authorization', `Bearer ${staff}`)
      .set('Idempotency-Key', 'seed-test-confirm-payment')
      .send({ receiptNumber: 'SEED-TEST-RECEIPT' })
      .expect(201);
    expect(
      (await db.registrationOrder.findUniqueOrThrow({ where: { id: demoId('order_thai-draft') } }))
        .status,
    ).toBe('COMPLETED');
  });

  it('can run again without duplicates or overwriting account and workflow changes', async () => {
    const editedOutcome = await db.learningOutcome.findUniqueOrThrow({
      where: { id: demoId('outcome_math-8_1') },
    });
    await db.learningOutcome.update({
      where: { id: editedOutcome.id },
      data: { statement: 'CLO đã được người soạn chỉnh sửa' },
    });
    await db.user.update({
      where: { email: 'manager@edugrade.local' },
      data: { displayName: 'Tên quản lý đã sửa', passwordHash: 'preserved-test-password-hash' },
    });
    const submission = await db.submission.findFirstOrThrow();
    await db.submission.update({
      where: { id: submission.id },
      data: { answers: [{ questionId: 'edited-through-app', answer: 'Bài làm đã sửa' }] },
    });
    const before = await counts(db);
    await seedDemo(db, 'a-new-hash-must-not-replace-existing-passwords', undefined, {});
    expect(
      (await db.learningOutcome.findUniqueOrThrow({ where: { id: editedOutcome.id } })).statement,
    ).toBe('CLO đã được người soạn chỉnh sửa');
    expect(await counts(db)).toEqual(before);
    const manager = await db.user.findUniqueOrThrow({ where: { email: 'manager@edugrade.local' } });
    expect(manager.displayName).toBe('Tên quản lý đã sửa');
    expect(manager.passwordHash).toBe('preserved-test-password-hash');
    expect(
      (await db.submission.findUniqueOrThrow({ where: { id: submission.id } })).answers,
    ).toEqual([{ questionId: 'edited-through-app', answer: 'Bài làm đã sửa' }]);
    expect(
      (await db.registrationOrder.findUniqueOrThrow({ where: { id: demoId('order_thai-draft') } }))
        .status,
    ).toBe('COMPLETED');
  }, 120_000);

  it('rolls back seed writes on incompatible account emails and rejects date changes', async () => {
    const before = await counts(db);
    await expect(
      seedDemo(db, 'unused', undefined, {
        SEED_MANAGER_EMAIL: 'another-manager@edugrade.local',
        SEED_TEACHER_EMAIL: 'parent@edugrade.local',
      }),
    ).rejects.toThrow('expected TEACHER');
    expect(
      await db.user.findUnique({ where: { email: 'another-manager@edugrade.local' } }),
    ).toBeNull();
    expect(await counts(db)).toEqual(before);
    await expect(seedDemo(db, 'unused', dateOnly(addDays(today, 1)), {})).rejects.toThrow(
      'Demo already uses',
    );
  });
  it('reseed removes all old data and sessions, reapplies migrations and seeds a fresh date/password', async () => {
    const outsider = await db.user.create({
      data: { email: 'outside-seed@test.local', role: 'STAFF', passwordHash: 'old-non-seed-hash' },
    });
    await db.authSession.create({
      data: { userId: outsider.id, refreshTokenHash: 'a'.repeat(64), expiresAt: addDays(today, 5) },
    });
    await db.fileAsset.create({
      data: {
        ownerId: outsider.id,
        storageKey: 'test/reseed-probe.pdf',
        name: 'reseed-probe.pdf',
        mimeType: 'application/pdf',
        size: 10,
      },
    });
    await db.$executeRawUnsafe('CREATE TABLE reseed_probe (id INT PRIMARY KEY)');
    await db.$executeRawUnsafe('INSERT INTO reseed_probe VALUES (1)');
    const freshDate = dateOnly(addDays(today, 1));
    const freshPassword = 'ReseedIntegration123!';
    await db.$disconnect();
    execFileSync(
      process.execPath,
      [require.resolve('ts-node/dist/bin.js'), '--transpile-only', 'src/database/reseed.ts'],
      {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DATABASE_URL: dbUrl.toString(),
          SEED_MODE: 'demo',
          SEED_REFERENCE_DATE: freshDate,
          SEED_DEFAULT_PASSWORD: freshPassword,
          SEED_MANAGER_EMAIL: 'manager@edugrade.local',
          SEED_STAFF_EMAIL: 'staff@edugrade.local',
          SEED_TEACHER_EMAIL: 'teacher@edugrade.local',
          SEED_CURRICULUM_DESIGNER_EMAIL: 'designer@edugrade.local',
          SEED_PARENT_EMAIL: 'parent@edugrade.local',
        },
        stdio: 'pipe',
        timeout: 120_000,
      },
    );
    expect(await db.user.findUnique({ where: { id: outsider.id } })).toBeNull();
    expect(await db.user.count()).toBe(20);
    expect(await db.studentProfile.count()).toBe(14);
    expect(await db.program.count()).toBe(16);
    expect(await db.authSession.count()).toBe(0);
    expect(await db.fileAsset.count()).toBe(0);
    expect(await db.idempotencyRecord.count()).toBe(0);
    expect(await db.payment.count()).toBe(12);
    const manager = await db.user.findUniqueOrThrow({ where: { email: 'manager@edugrade.local' } });
    expect(manager.displayName).not.toBe('Tên quản lý đã sửa');
    expect(await bcrypt.compare(freshPassword, manager.passwordHash!)).toBe(true);
    const manifest = await db.auditLog.findUniqueOrThrow({ where: { id: demoId('manifest') } });
    expect(manifest.afterData).toMatchObject({ referenceDate: freshDate });
    expect(
      (await db.registrationOrder.findUniqueOrThrow({ where: { id: demoId('order_thai-draft') } }))
        .status,
    ).toBe('DRAFT');
    const customTables = await db.$queryRaw<
      Array<{ tableName: string }>
    >`SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${dbName} AND TABLE_NAME = 'reseed_probe'`;
    expect(customTables).toHaveLength(0);
    const migrations = await db.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    const expectedMigrations = readdirSync('prisma/migrations', { withFileTypes: true }).filter(
      (entry) => entry.isDirectory(),
    ).length;
    expect(Number(migrations[0].count)).toBe(expectedMigrations);
  }, 120_000);
});

async function counts(db: PrismaClient): Promise<number[]> {
  return Promise.all([
    db.user.count(),
    db.parentProfile.count(),
    db.studentProfile.count(),
    db.subject.count(),
    db.program.count(),
    db.class.count(),
    db.room.count(),
    db.classWeeklySchedule.count(),
    db.curriculumTrack.count(),
    db.curriculumUnit.count(),
    db.lesson.count(),
    db.registrationOrder.count(),
    db.payment.count(),
    db.enrollment.count(),
    db.enrollmentPlacement.count(),
    db.enrollmentTransfer.count(),
    db.scheduleGeneration.count(),
    db.classSession.count(),
    db.sessionParticipant.count(),
    db.leaveRequest.count(),
    db.makeupBooking.count(),
    db.assignment.count(),
    db.assignmentQuestion.count(),
    db.assignmentRecipient.count(),
    db.submission.count(),
    db.gradeReview.count(),
    db.gradingJob.count(),
    db.curriculumFeedback.count(),
    db.announcement.count(),
    db.accountInvitation.count(),
    db.learningReport.count(),
    db.outboxEvent.count(),
    db.auditLog.count(),
  ]);
}
