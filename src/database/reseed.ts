import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readSeedConfiguration } from './seeds/seed-configuration';

async function reseed(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  // Reject known configuration errors before resetting any data.
  const config = readSeedConfiguration(process.env, true);
  const target = new URL(config.databaseUrl);
  console.log(
    `Resetting MySQL database ${target.pathname.slice(1)} at ${target.hostname}:${target.port || '3306'}. All existing data in this database will be deleted.`,
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'migrate',
        'reset',
        '--force',
        '--skip-seed',
        '--skip-generate',
      ],
      { stdio: 'inherit', env: process.env },
    );
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Prisma database reset failed (${signal ?? code ?? 'unknown exit'}). Seed was not run.`,
          ),
        );
    });
  });
  // Reset changes database contents; the generated client comes from the existing setup.
  const { runSeed } = await import('./seeds/seed-runner');
  await runSeed(config, true);
}

reseed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Reseed failed.');
  process.exitCode = 1;
});
