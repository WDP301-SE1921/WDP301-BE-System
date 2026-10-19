import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { readSeedConfiguration } from './seeds/seed-configuration';
import { addDays, localInstant, monthStart, referenceDate } from './seeds/seed-calendar';
import { demoReferenceDate, seedDashboard } from './seeds/seed-dashboard';
import { seedDemo } from './seeds/seed-demo';

/** Adds the bulk dashboard layer; seeds the demo first when the database has none. */
async function seedDashboardData(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  // Demo mode is refused in production, so the bulk layer never reaches a real database.
  const config = readSeedConfiguration({ ...process.env, SEED_MODE: 'demo' });
  const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });
  try {
    const passwordHash = await bcrypt.hash(config.password, 12);
    if (!(await demoReferenceDate(prisma))) {
      console.log('Demo dataset not found; running the demo seed first.');
      await seedDemo(prisma, passwordHash, config.referenceDate);
    }
    const result = await seedDashboard(prisma, passwordHash);
    console.log(
      result.created
        ? `Dashboard seed completed for reference date ${result.referenceDate}.`
        : `Dashboard seed already applied (reference date ${result.referenceDate}); nothing changed. Run pnpm reseed:dashboard to rebuild it.`,
    );
    if (result.created) console.log(`Rows created: ${JSON.stringify(result.rows)}`);
    await printSummary(prisma, referenceDate(result.referenceDate));
  } finally {
    await prisma.$disconnect();
  }
}

async function printSummary(prisma: PrismaClient, today: Date): Promise<void> {
  const money = new Intl.NumberFormat('vi-VN');
  const from = localInstant(monthStart(today));
  const to = localInstant(monthStart(today, 1));
  const [revenue, studying, active, teachers, openClasses] = await Promise.all([
    prisma.payment.aggregate({
      where: { status: 'CONFIRMED', confirmedAt: { gte: from, lt: to } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.studentProfile.count({
      where: {
        status: 'ACTIVE',
        enrollments: {
          some: { status: 'ACTIVE', startDate: { lte: today }, endDate: { gt: today } },
        },
      },
    }),
    prisma.studentProfile.count({ where: { status: 'ACTIVE' } }),
    prisma.user.count({ where: { role: 'TEACHER', status: 'ACTIVE' } }),
    prisma.class.count({ where: { isOpen: true, isActive: true } }),
  ]);
  console.log(
    `Reference month: revenue ${money.format(Number(revenue._sum.amount ?? 0))} VND from ${revenue._count} payments; studying ${studying}/${active} active students; ${teachers} active teachers; ${openClasses} open classes.`,
  );
  for (let offset = -5; offset <= 0; offset++) {
    const start = localInstant(monthStart(today, offset));
    const end = localInstant(monthStart(today, offset + 1));
    const [paid, sessions] = await Promise.all([
      prisma.payment.aggregate({
        where: { status: 'CONFIRMED', confirmedAt: { gte: start, lt: end } },
        _sum: { amount: true },
      }),
      prisma.classSession.count({
        where: { status: 'COMPLETED', startsAt: { gte: start, lt: end } },
      }),
    ]);
    console.log(
      `  ${monthStart(today, offset).toISOString().slice(0, 7)}: ${money.format(Number(paid._sum.amount ?? 0))} VND, ${sessions} completed sessions`,
    );
  }
  const todaySessions = await prisma.classSession.groupBy({
    by: ['status'],
    where: { startsAt: { gte: localInstant(today), lt: localInstant(addDays(today, 1)) } },
    _count: true,
  });
  console.log(
    `Sessions on the reference date: ${todaySessions.map((row) => `${row.status} ${row._count}`).join(', ')}`,
  );
}

seedDashboardData().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Dashboard seed failed.');
  process.exitCode = 1;
});
