import { execFileSync } from 'node:child_process';
import * as bcrypt from 'bcrypt';
import * as mysql from 'mysql2/promise';
import { PrismaClient } from '@prisma/client';
import { CURRICULUM_EDITION } from '../../src/database/seeds/curriculum-content';
import {
  dateOnly,
  demoId,
  localInstant,
  referenceDate,
  studyDay,
} from '../../src/database/seeds/seed-calendar';
import { BULK_PREFIX, bulkId, seedDashboard } from '../../src/database/seeds/seed-dashboard';
import { seedDemo } from '../../src/database/seeds/seed-demo';
import {
  DASHBOARD_MANIFEST_ID,
  DASHBOARD_SEED_VERSION,
  DEMO_SEED_VERSION,
} from '../../src/database/seeds/seed-manifest';
import { isSeedHoliday } from '../../src/database/seeds/seed-makeup';
import { applySeedRepairs, planSeedRepairs } from '../../src/database/seeds/seed-repair';

const source = new URL(
  process.env.ACADEMIC_TEST_DATABASE_URL ?? 'mysql://root:admin123@localhost:3307',
);

describe('Complete seed workflow and non-destructive upgrade', () => {
  let connection: mysql.Connection;
  let passwordHash: string;
  let sequence = 0;
  beforeAll(async () => {
    connection = await mysql.createConnection({
      host: source.hostname,
      port: Number(source.port || 3306),
      user: decodeURIComponent(source.username),
      password: decodeURIComponent(source.password),
    });
    passwordHash = await bcrypt.hash('SeedWorkflow123!', 4);
  });
  afterAll(async () => {
    if (connection) await connection.end();
  });

  async function dataset(date: string, run: (db: PrismaClient) => Promise<void>): Promise<void> {
    const name = `edugrade_seed_workflow_test_${process.pid}_${Date.now()}_${sequence++}`;
    const url = new URL(source);
    url.pathname = `/${name}`;
    await connection.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [
      name,
    ]);
    const db = new PrismaClient({ datasourceUrl: url.toString() });
    try {
      execFileSync(
        process.execPath,
        [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
        { env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: url.toString() }, stdio: 'pipe' },
      );
      await seedDemo(db, passwordHash, date, {});
      await run(db);
    } finally {
      await db.$disconnect();
      await connection.query('DROP DATABASE IF EXISTS ??', [name]);
    }
  }

  async function counts(db: PrismaClient): Promise<number[]> {
    return Promise.all([
      db.user.count(),
      db.lesson.count(),
      db.classSession.count(),
      db.sessionParticipant.count(),
      db.registrationOrder.count(),
      db.payment.count(),
      db.auditLog.count(),
    ]);
  }

  it.each(['2026-02-08', '2026-11-19', '2027-01-29'])(
    'seeds consistent rooms, CLOs, bills and makeups at %s',
    async (date) => {
      await dataset(date, async (db) => {
        const classes = await db.class.findMany({ include: { room: true } });
        expect(classes.every((row) => row.room && row.capacity === row.room.capacity)).toBe(true);
        const full = classes.find((row) => row.id === demoId('class_math-8-full'))!;
        expect(full.room?.capacity).toBe(2);
        expect(await db.enrollment.count({ where: { classId: full.id, status: 'ACTIVE' } })).toBe(
          2,
        );
        const sessions = await db.classSession.findMany();
        expect(sessions.filter((row) => isSeedHoliday(studyDay(row.startsAt)))).toEqual([]);
        expect(await db.makeupBooking.count()).toBe(4);
        const feedback = await db.curriculumFeedback.findUniqueOrThrow({
          where: { id: demoId('feedback_RESOLVED') },
          include: {
            lesson: { include: { outcomeLinks: true } },
            resolutionLesson: { include: { outcomeLinks: true } },
          },
        });
        expect(
          feedback.resolutionLesson?.outcomeLinks.map((link) => link.outcomeId).sort(),
        ).toEqual(feedback.lesson.outcomeLinks.map((link) => link.outcomeId).sort());
        expect(await db.learningOutcome.count()).toBe(425);
        expect(await db.learningOutcome.count({ where: { sourceStatus: 'VERIFIED' } })).toBe(0);
        if (date === '2026-11-19') {
          const order = await db.registrationOrder.findUniqueOrThrow({
            where: { id: demoId('order_khanh-upcoming') },
            include: { payment: true },
          });
          expect(dateOnly(order.startDate!)).toBe('2026-11-26');
          expect(order.listAmount?.toString()).toBe('2400000');
          expect(order.tetDiscountAmount?.toString()).toBe('400000');
          expect(order.quotedAmount.toString()).toBe('2000000');
          expect(order.payment?.amount.toString()).toBe('2000000');
        }
        const before = await counts(db);
        await seedDemo(db, 'must-not-replace-passwords', undefined, {});
        expect(await counts(db)).toEqual(before);
      });
    },
    180_000,
  );

  it('rejects old manifests from both entry points before changing any data', async () => {
    await dataset('2026-11-19', async (db) => {
      await db.auditLog.update({
        where: { id: demoId('manifest') },
        data: {
          afterData: {
            referenceDate: '2026-11-19',
            curriculumEdition: CURRICULUM_EDITION,
            version: 2,
          },
        },
      });
      const before = await counts(db);
      await expect(seedDemo(db, 'unused', undefined, {})).rejects.toThrow('db:seed:repair');
      await expect(seedDashboard(db, 'unused')).rejects.toThrow('db:seed:repair');
      expect(await counts(db)).toEqual(before);
    });
  }, 180_000);

  it('previews and repairs legacy metadata while preserving confirmed money and history', async () => {
    await dataset('2026-11-19', async (db) => {
      await db.auditLog.update({
        where: { id: demoId('manifest') },
        data: {
          afterData: {
            referenceDate: '2026-11-19',
            curriculumEdition: CURRICULUM_EDITION,
            version: 2,
          },
        },
      });
      await db.class.update({ where: { id: demoId('class_math-8-a') }, data: { capacity: 20 } });
      await db.class.update({
        where: { id: demoId('class_math-8-full') },
        data: { roomId: demoId('room_0') },
      });
      await db.classSession.updateMany({
        where: { classId: demoId('class_math-8-full') },
        data: { roomId: demoId('room_0') },
      });
      const confirmedId = demoId('order_khanh-upcoming');
      await db.registrationOrder.update({
        where: { id: confirmedId },
        data: {
          quotedAmount: '2400000',
          listAmount: null,
          tetDiscountAmount: null,
          tetPeriodStart: null,
          tetPeriodEnd: null,
        },
      });
      await db.payment.update({
        where: { registrationOrderId: confirmedId },
        data: { amount: '2400000' },
      });
      await db.registrationOrder.update({
        where: { id: demoId('order_thai-draft') },
        data: {
          startDate: referenceDate('2026-11-25'),
          endDate: referenceDate('2027-02-25'),
          packageMonths: 3,
          quotedAmount: '2400000',
          listAmount: null,
        },
      });
      await db.lessonOutcome.deleteMany({
        where: { lessonId: demoId('lesson_feedback_revision') },
      });
      await db.lessonOutcome.create({
        data: {
          lessonId: demoId('lesson_feedback_revision'),
          outcomeId: demoId('outcome_math-8_1'),
        },
      });
      const confirmedBefore = await db.registrationOrder.findUniqueOrThrow({
        where: { id: confirmedId },
        include: { payment: true },
      });
      const sessionsBefore = await db.classSession.findMany({ orderBy: { id: 'asc' } });
      const before = await counts(db);
      const now = localInstant(referenceDate('2026-11-19'), 12);
      const preview = await planSeedRepairs(db, now);
      expect(preview.compatible).toBe(true);
      expect(preview.actions.some((change) => change.kind === 'DRAFT_PRICE')).toBe(true);
      expect(
        preview.findings.some(
          (finding) => finding.id === confirmedId && finding.code === 'LEGACY_BILL_PRESERVED',
        ),
      ).toBe(true);
      expect(await counts(db)).toEqual(before);
      const revision = await db.lesson.findUniqueOrThrow({
        where: { id: demoId('lesson_feedback_revision') },
      });
      await db.lesson.update({
        where: { id: revision.id },
        data: { content: 'Nội dung đã sửa qua ứng dụng' },
      });
      expect((await planSeedRepairs(db, now)).compatible).toBe(false);
      await expect(applySeedRepairs(db, now)).rejects.toThrow('Repair is blocked');
      expect(
        (await db.class.findUniqueOrThrow({ where: { id: demoId('class_math-8-a') } })).capacity,
      ).toBe(20);
      expect(await counts(db)).toEqual(before);
      await db.lesson.update({ where: { id: revision.id }, data: { content: revision.content } });
      await applySeedRepairs(db, now);
      expect(
        await db.registrationOrder.findUniqueOrThrow({
          where: { id: confirmedId },
          include: { payment: true },
        }),
      ).toEqual(confirmedBefore);
      expect(await db.classSession.findMany({ orderBy: { id: 'asc' } })).toEqual(sessionsBefore);
      expect(
        (
          await db.registrationOrder.findUniqueOrThrow({
            where: { id: demoId('order_thai-draft') },
          })
        ).quotedAmount.toString(),
      ).toBe('2000000');
      expect(
        (await db.class.findUniqueOrThrow({ where: { id: demoId('class_math-8-a') } })).capacity,
      ).toBe(30);
      expect(
        (
          await db.lessonOutcome.findMany({
            where: { lessonId: demoId('lesson_feedback_revision') },
          })
        ).map((link) => link.outcomeId),
      ).toEqual([demoId('outcome_math-8_3')]);
      expect((await planSeedRepairs(db, now)).actions).toEqual([]);
      const repaired = await counts(db);
      await seedDemo(db, 'unused', undefined, {});
      expect(await counts(db)).toEqual(repaired);
    });
  }, 180_000);

  it('moves an untouched upcoming Tết makeup and keeps completed sessions unchanged', async () => {
    await dataset('2026-02-08', async (db) => {
      await db.auditLog.update({
        where: { id: demoId('manifest') },
        data: {
          afterData: {
            referenceDate: '2026-02-08',
            curriculumEdition: CURRICULUM_EDITION,
            version: 2,
          },
        },
      });
      await db.classSession.update({
        where: { id: demoId('makeup_session_BOOKED') },
        data: {
          startsAt: localInstant(referenceDate('2026-02-10'), 14),
          endsAt: localInstant(referenceDate('2026-02-10'), 16),
        },
      });
      const completed = await db.classSession.findMany({
        where: { status: 'COMPLETED' },
        orderBy: { id: 'asc' },
      });
      await applySeedRepairs(db, localInstant(referenceDate('2026-02-08'), 12));
      const repaired = await db.classSession.findUniqueOrThrow({
        where: { id: demoId('makeup_session_BOOKED') },
      });
      expect(dateOnly(studyDay(repaired.startsAt))).toBe('2026-02-24');
      expect(
        await db.classSession.findMany({ where: { status: 'COMPLETED' }, orderBy: { id: 'asc' } }),
      ).toEqual(completed);
    });
  }, 180_000);

  it('keeps published demo lessons intact and upgrades dashboard CLOs and lifecycle atomically', async () => {
    await dataset('2026-11-19', async (db) => {
      const demoLessons = await db.lesson.findMany({
        where: { id: { startsWith: 'seed_demo_v1_' } },
        orderBy: { id: 'asc' },
      });
      const now = localInstant(referenceDate('2026-11-19'), 15, 30);
      await seedDashboard(db, passwordHash, { now });
      expect(
        await db.lesson.findMany({
          where: { id: { startsWith: 'seed_demo_v1_' } },
          orderBy: { id: 'asc' },
        }),
      ).toEqual(demoLessons);
      expect(
        await db.lesson.count({
          where: { id: { startsWith: BULK_PREFIX }, outcomeLinks: { none: {} } },
        }),
      ).toBe(0);
      expect(
        await db.curriculumUnit.count({
          where: { id: { startsWith: BULK_PREFIX }, status: 'APPROVED' },
        }),
      ).toBe(0);
      await db.lessonOutcome.deleteMany({ where: { lessonId: { startsWith: BULK_PREFIX } } });
      await db.curriculumUnit.updateMany({
        where: { id: { startsWith: BULK_PREFIX } },
        data: { status: 'APPROVED', archivedAt: null, archiveReason: null, supersededById: null },
      });
      await db.auditLog.update({
        where: { id: DASHBOARD_MANIFEST_ID },
        data: { afterData: { referenceDate: '2026-11-19', version: 1 } },
      });
      const paidBefore = await db.payment.findMany({ orderBy: { id: 'asc' } });
      await applySeedRepairs(db, now);
      expect(await db.payment.findMany({ orderBy: { id: 'asc' } })).toEqual(paidBefore);
      expect(
        await db.lesson.count({
          where: { id: { startsWith: BULK_PREFIX }, outcomeLinks: { none: {} } },
        }),
      ).toBe(0);
      expect(
        (
          await db.curriculumUnit.findUniqueOrThrow({
            where: { id: bulkId('unit_math-8_history') },
          })
        ).archiveReason,
      ).toBe('SUPERSEDED');
      const manifest = await db.auditLog.findUniqueOrThrow({
        where: { id: DASHBOARD_MANIFEST_ID },
      });
      expect(manifest.afterData).toMatchObject({
        version: DASHBOARD_SEED_VERSION,
        demoSeedVersion: DEMO_SEED_VERSION,
        curriculumEdition: CURRICULUM_EDITION,
      });
      expect((await seedDashboard(db, 'unused', { now })).created).toBe(false);
      expect((await planSeedRepairs(db, now)).actions).toEqual([]);
    });
  }, 300_000);
});
