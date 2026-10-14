import { readSeedConfiguration } from '../../src/database/seeds/seed-configuration';

const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'mysql://root:test@localhost:3307/edugrade_db',
  SEED_DEFAULT_PASSWORD: 'ConfigurationTest123!',
};

describe('Seed/reseed configuration before database writes', () => {
  it('uses demo mode by default and permits a development reseed', () => {
    expect(readSeedConfiguration(env, true)).toMatchObject({
      mode: 'demo',
      databaseUrl: env.DATABASE_URL,
    });
  });
  it('permits the existing explicit production accounts seed without allowing a reset', () => {
    const production = {
      ...env,
      NODE_ENV: 'production',
      SEED_MODE: 'accounts',
      SEED_ALLOW_PRODUCTION: 'true',
    };
    expect(readSeedConfiguration(production).mode).toBe('accounts');
    expect(() => readSeedConfiguration(production, true)).toThrow('Reseed is only permitted');
    expect(() => readSeedConfiguration({ ...production, SEED_MODE: 'demo' })).toThrow(
      'Production only permits',
    );
  });
  it.each([undefined, '', 'production', 'staging'])(
    'rejects reset in environment %s',
    (nodeEnv) => {
      expect(() => readSeedConfiguration({ ...env, NODE_ENV: nodeEnv }, true)).toThrow(
        'Reseed is only permitted',
      );
    },
  );
  it.each([undefined, '', 'short', 'é'.repeat(37)])(
    'rejects a missing/invalid password before reset',
    (password) => {
      expect(() =>
        readSeedConfiguration({ ...env, SEED_DEFAULT_PASSWORD: password }, true),
      ).toThrow('SEED_DEFAULT_PASSWORD');
    },
  );
  it('rejects mode, date and email mistakes before reset', () => {
    expect(() => readSeedConfiguration({ ...env, SEED_MODE: 'other' }, true)).toThrow('SEED_MODE');
    expect(() =>
      readSeedConfiguration({ ...env, SEED_REFERENCE_DATE: '2026-02-30' }, true),
    ).toThrow('SEED_REFERENCE_DATE');
    expect(() =>
      readSeedConfiguration({ ...env, SEED_TEACHER_EMAIL: 'invalid email' }, true),
    ).toThrow('Invalid seed account email');
    expect(() =>
      readSeedConfiguration({ ...env, SEED_TEACHER_EMAIL: ' PARENT@edugrade.local ' }, true),
    ).toThrow('must be distinct');
  });
  it.each(['', 'not-a-url', 'mysql://localhost:3307/', 'postgresql://localhost/edugrade_db'])(
    'rejects invalid database target %s',
    (url) => {
      expect(() => readSeedConfiguration({ ...env, DATABASE_URL: url }, true)).toThrow(
        'DATABASE_URL',
      );
    },
  );
  it.each(['mysql', 'information_schema', 'performance_schema', 'sys'])(
    'rejects resetting system database %s',
    (name) => {
      expect(() =>
        readSeedConfiguration(
          { ...env, DATABASE_URL: `mysql://root:test@localhost:3307/${name}` },
          true,
        ),
      ).toThrow('system database');
    },
  );
});
