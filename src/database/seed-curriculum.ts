import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { CURRICULUM_EDITION } from './seeds/curriculum-content';
import {
  planTextbookCurricula,
  readTextbookSeedConfiguration,
  seedTextbookCurricula,
} from './seeds/seed-textbook-curriculum';

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply'))
    throw new Error('Usage: pnpm db:seed:curriculum [--apply]');
  const config = readTextbookSeedConfiguration(process.env);
  const target = new URL(config.databaseUrl);
  const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });
  try {
    const plans = await planTextbookCurricula(prisma, config.designerEmail);
    console.log(
      `Curriculum edition: ${CURRICULUM_EDITION}; target: ${target.hostname}:${target.port || '3306'}${target.pathname}`,
    );
    console.table(
      plans.map((plan) => ({
        program: plan.programName,
        key: plan.key,
        lessons: plan.lessons,
        action: plan.exists ? 'preserve' : 'create draft',
      })),
    );
    if (!args.includes('--apply')) {
      console.log(
        'Preview complete. Use --apply to add the listed drafts. Existing curricula, accounts and schedules are preserved.',
      );
      return;
    }
    console.log(
      `Textbook seed completed: ${JSON.stringify(await seedTextbookCurricula(prisma, config))}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Textbook seed failed.');
  process.exitCode = 1;
});
