import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { readTextbookSeedConfiguration } from './seeds/seed-textbook-curriculum';
import { applySeedRepairs, planSeedRepairs } from './seeds/seed-repair';

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply'))
    throw new Error('Usage: pnpm db:seed:repair [--apply]');
  const config = readTextbookSeedConfiguration(process.env);
  const target = new URL(config.databaseUrl);
  const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });
  try {
    console.log(
      `Seed repair target: ${target.hostname}:${target.port || '3306'}${target.pathname}`,
    );
    const plan = args.includes('--apply')
      ? await applySeedRepairs(prisma)
      : await planSeedRepairs(prisma);
    console.table(
      plan.actions.map((change) => ({
        kind: change.kind,
        id: change.id,
        before: JSON.stringify(change.before),
        after: JSON.stringify(change.after),
      })),
    );
    console.table(plan.findings);
    console.log(
      JSON.stringify({
        referenceDate: plan.referenceDate,
        compatible: plan.compatible,
        changes: plan.actions.length,
        mode: args.includes('--apply') ? 'applied' : 'preview',
      }),
    );
    if (!plan.compatible) process.exitCode = 1;
    else if (!args.includes('--apply'))
      console.log(
        'Read-only preview complete. Use --apply to apply compatible repairs atomically. Confirmed bills, completed sessions and edited content are preserved.',
      );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed repair failed.');
  process.exitCode = 1;
});
