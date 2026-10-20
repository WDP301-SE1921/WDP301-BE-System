import { Prisma, type PrismaClient } from '@prisma/client';
import { seedAccounts, type SeedUsers } from './seed-accounts';
import { seedCatalog } from './seed-catalog';
import { seedEnrollments } from './seed-enrollments';
import { seedSessions, seedLeavesAndMakeups } from './seed-sessions';
import { seedAssessments } from './seed-assessments';
import { seedOperations } from './seed-operations';
import { demoId, localInstant, referenceDate } from './seed-calendar';

export interface DemoSeedResult {
  referenceDate: string;
  users: SeedUsers;
}

/** All demo writes commit together. Empty updates preserve data changed through the app. */
export async function seedDemo(
  prisma: PrismaClient,
  passwordHash: string,
  date?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DemoSeedResult> {
  return prisma.$transaction(
    async (tx) => {
      const manifest = await tx.auditLog.findUnique({ where: { id: demoId('manifest') } });
      const stored = manifest?.afterData;
      const savedDate =
        stored &&
        typeof stored === 'object' &&
        !Array.isArray(stored) &&
        typeof stored.referenceDate === 'string'
          ? stored.referenceDate
          : undefined;
      if (savedDate && date && savedDate !== date)
        throw new Error(
          `Demo already uses SEED_REFERENCE_DATE=${savedDate}. Re-running preserves its dates; use a separate database or pnpm reseed to replace all data with a new reference date.`,
        );
      const today = referenceDate(savedDate ?? date);
      const users = await seedAccounts(tx, passwordHash, true, localInstant(today, 9), env);
      const catalog = await seedCatalog(tx, users, today);
      const enrollments = await seedEnrollments(tx, users, catalog, today);
      const sessions = await seedSessions(tx, users, catalog, enrollments, today);
      await seedLeavesAndMakeups(tx, users, enrollments, sessions, today);
      await seedAssessments(tx, users, catalog, enrollments, today);
      await seedOperations(tx, users, catalog, today);
      await tx.auditLog.upsert({
        where: { id: demoId('manifest') },
        update: {},
        create: {
          id: demoId('manifest'),
          actorUserId: users.manager.id,
          action: 'DEMO_SEED_CREATED',
          entityType: 'DemoDataset',
          entityId: 'v1',
          afterData: {
            referenceDate: today.toISOString().slice(0, 10),
            source: 'CLASS_CURRICULUM_INPUT_TEMPLATE',
            version: 1,
          },
          createdAt: localInstant(today, 9),
        },
      });
      return { referenceDate: today.toISOString().slice(0, 10), users };
    },
    {
      // TiDB supports repeatable-read and read-committed, but not serializable.
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 10_000,
      timeout: 120_000,
    },
  );
}
