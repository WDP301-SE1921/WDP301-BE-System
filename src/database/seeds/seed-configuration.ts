import { validateSeedAccountEmails } from './seed-accounts';
import { referenceDate } from './seed-calendar';

export interface SeedConfiguration {
  mode: 'accounts' | 'demo';
  password: string;
  databaseUrl: string;
  referenceDate?: string;
}

export function readSeedConfiguration(env: NodeJS.ProcessEnv, reset = false): SeedConfiguration {
  if (reset && env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test')
    throw new Error('Reseed is only permitted with NODE_ENV=development or NODE_ENV=test.');
  const production = env.NODE_ENV === 'production';
  const mode = env.SEED_MODE ?? (production ? 'accounts' : 'demo');
  if (mode !== 'accounts' && mode !== 'demo')
    throw new Error('SEED_MODE must be accounts or demo.');
  if (production && (env.SEED_ALLOW_PRODUCTION !== 'true' || mode === 'demo'))
    throw new Error(
      'Production only permits account seeding with SEED_MODE=accounts and SEED_ALLOW_PRODUCTION=true. Demo data is for development/test databases.',
    );
  const password = env.SEED_DEFAULT_PASSWORD;
  if (!password || password.length < 8)
    throw new Error('Set SEED_DEFAULT_PASSWORD (at least 8 characters) before seeding.');
  if (Buffer.byteLength(password, 'utf8') > 72)
    throw new Error('SEED_DEFAULT_PASSWORD must be at most 72 UTF-8 bytes.');
  const date = env.SEED_REFERENCE_DATE?.trim() || undefined;
  if (mode === 'demo' && date) referenceDate(date);
  validateSeedAccountEmails(mode === 'demo', env);

  let url: URL;
  try {
    url = new URL(env.DATABASE_URL ?? '');
  } catch {
    throw new Error('DATABASE_URL must be a valid MySQL connection URL with a database name.');
  }
  const name = url.pathname.slice(1);
  if (url.protocol !== 'mysql:' || !url.hostname || !name || name.includes('/'))
    throw new Error('DATABASE_URL must be a valid MySQL connection URL with a database name.');
  if (
    reset &&
    ['mysql', 'information_schema', 'performance_schema', 'sys'].includes(
      decodeURIComponent(name).toLowerCase(),
    )
  )
    throw new Error('Reseed cannot reset a MySQL system database.');
  return { mode, password, databaseUrl: url.toString(), referenceDate: date };
}
