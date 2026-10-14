import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { seedAccounts } from './seed-accounts';
import { seedDemo } from './seed-demo';
import type { SeedConfiguration } from './seed-configuration';

export async function runSeed(config: SeedConfiguration, reset = false): Promise<void> {
  const passwordHash = await bcrypt.hash(config.password, 12);
  const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });
  try {
    const users =
      config.mode === 'demo'
        ? (await seedDemo(prisma, passwordHash, config.referenceDate)).users
        : await prisma.$transaction((tx) => seedAccounts(tx, passwordHash, false, new Date()));
    console.log(
      `${reset ? 'Reseed' : 'Seed'} ${config.mode} completed. ${reset ? 'Database was reset and seeded again.' : 'Existing records and passwords were preserved.'}`,
    );
    for (const user of Object.values(users))
      console.log(`${user.role.padEnd(20)} ${user.email} (${user.status})`);
    if (config.mode === 'demo') {
      const tables = [
        ['subjects', prisma.subject.count()],
        ['programs', prisma.program.count()],
        ['rooms', prisma.room.count()],
        ['classes', prisma.class.count()],
        ['students', prisma.studentProfile.count()],
        ['curriculumUnits', prisma.curriculumUnit.count()],
        ['lessons', prisma.lesson.count()],
        ['sessions', prisma.classSession.count()],
        ['registrations', prisma.registrationOrder.count()],
        ['payments', prisma.payment.count()],
        ['enrollments', prisma.enrollment.count()],
        ['assignments', prisma.assignment.count()],
        ['submissions', prisma.submission.count()],
        ['grades', prisma.gradeReview.count()],
      ] as const;
      const counts = await Promise.all(tables.map(async ([name, count]) => [name, await count]));
      console.log(`Database totals: ${JSON.stringify(Object.fromEntries(counts))}`);
      console.log(
        'Curriculum: Toán, Vật lý, Hóa học, Sinh học; grades 6–9. No pending email/AI jobs or fake storage files were created.',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}
