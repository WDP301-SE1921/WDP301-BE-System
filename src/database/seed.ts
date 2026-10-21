import { existsSync } from 'node:fs';
import { readSeedConfiguration } from './seeds/seed-configuration';
import { runSeed } from './seeds/seed-runner';

async function seed(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  await runSeed(readSeedConfiguration(process.env));
}

seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Seed failed.');
  process.exitCode = 1;
});
