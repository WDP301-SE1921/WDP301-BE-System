import { validateEnvironment } from '../../src/config/configuration';
import type { DatabaseService } from '../../src/database/orm/database.service';
import { readSeedConfiguration } from '../../src/database/seeds/seed-configuration';
import { DEMO_CENTER_CONTACT, seedCenterProfile } from '../../src/database/seeds/seed-center';
import { CenterController } from '../../src/modules/center/center.controller';
import {
  CENTER_PROFILE_ID,
  centerContactFromEnv,
  type CenterContact,
} from '../../src/modules/center/center-profile';

const BASE_ENVIRONMENT = {
  DATABASE_URL: 'mysql://root:secret@localhost:3306/edugrade_db',
  CORS_ORIGINS: 'http://localhost:3001',
  JWT_ACCESS_SECRET: 'center-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'center-refresh-secret-at-least-32-characters',
};

type Row = CenterContact & { id: string };

interface Upsert {
  where: { id: string };
  create: Partial<Row>;
  update: Partial<CenterContact>;
}

/** One-row table with Prisma's upsert semantics. */
function fakeCenterTable(initial: Row | null = null): {
  db: { centerProfile: { upsert: (args: Upsert) => Promise<Row> } };
  row: () => Row | null;
} {
  let stored = initial;
  const empty: Row = {
    id: CENTER_PROFILE_ID,
    name: null,
    address: null,
    phone: null,
    email: null,
    openingHours: null,
  };
  return {
    db: {
      centerProfile: {
        upsert: ({ create, update }: Upsert): Promise<Row> => {
          stored = stored ? { ...stored, ...update } : { ...empty, ...create };
          return Promise.resolve(stored);
        },
      },
    },
    row: () => stored,
  };
}

describe('center contact details', () => {
  it('reads only the CENTER_* variables that are set and not blank', () => {
    expect(
      centerContactFromEnv({
        CENTER_NAME: ' Trung tâm EduGrade ',
        CENTER_PHONE: '028 1234 5678',
        CENTER_EMAIL: '   ',
      }),
    ).toEqual({ name: 'Trung tâm EduGrade', phone: '028 1234 5678' });
  });

  it('passes the CENTER_* values to the seed', () => {
    const config = readSeedConfiguration({
      ...BASE_ENVIRONMENT,
      NODE_ENV: 'development',
      SEED_DEFAULT_PASSWORD: 'SeedPassword#2026',
      CENTER_PHONE: '028 1234 5678',
    });

    expect(config.center).toEqual({ phone: '028 1234 5678' });
  });

  it('seeds demo details, then applies CENTER_* values without clearing the others', async () => {
    const table = fakeCenterTable();

    await seedCenterProfile(table.db as never, {}, true);
    expect(table.row()).toMatchObject(DEMO_CENTER_CONTACT);

    await seedCenterProfile(table.db as never, { phone: '028 1234 5678' }, true);
    expect(table.row()).toMatchObject({ ...DEMO_CENTER_CONTACT, phone: '028 1234 5678' });
  });

  it('account-only seeding creates the row from CENTER_* values alone', async () => {
    const table = fakeCenterTable();

    await seedCenterProfile(table.db as never, { name: 'Trung tâm EduGrade' }, false);

    expect(table.row()).toMatchObject({ name: 'Trung tâm EduGrade', phone: null, address: null });
  });

  it('serves the stored row, or nulls when the row is missing', async () => {
    const findUnique = jest.fn<Promise<Row | null>, [{ where: { id: string } }]>();
    const db = { centerProfile: { findUnique } };
    const controller = new CenterController(db as unknown as DatabaseService);

    findUnique.mockResolvedValueOnce({ id: CENTER_PROFILE_ID, ...DEMO_CENTER_CONTACT });
    await expect(controller.info()).resolves.toEqual(DEMO_CENTER_CONTACT);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: CENTER_PROFILE_ID } });

    findUnique.mockResolvedValueOnce(null);
    await expect(controller.info()).resolves.toEqual({
      name: null,
      address: null,
      phone: null,
      email: null,
      openingHours: null,
    });
  });

  it('keeps sessions within the max age by default', () => {
    const { jwt } = validateEnvironment(BASE_ENVIRONMENT);

    expect(jwt.refreshTtlSeconds).toBe(604800);
    expect(jwt.sessionMaxAgeSeconds).toBe(7776000);
  });
});
