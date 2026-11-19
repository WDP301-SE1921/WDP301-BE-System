import { Prisma } from '@prisma/client';
import { tetBreaks } from '../../src/common/lunar-new-year';
import {
  dateOnly,
  localInstant,
  maximumWeeklySlots,
  referenceDate,
} from '../../src/database/seeds/seed-calendar';
import { makeupCandidateDays } from '../../src/database/seeds/seed-makeup';
import {
  DASHBOARD_SEED_VERSION,
  DEMO_SEED_VERSION,
  hasCurrentDashboardManifest,
  readDemoManifest,
} from '../../src/database/seeds/seed-manifest';
import { CURRICULUM_EDITION } from '../../src/database/seeds/curriculum-content';
import { slotsForRange } from '../../src/modules/curriculum-scheduling/curriculum-scheduling.service';

describe('Seed workflow date and compatibility regressions', () => {
  it.each([
    ['2026-01-01', '2026-04-30'],
    ['2026-10-01', '2027-01-31'],
    ['2027-01-01', '2027-04-30'],
  ])('prepares enough approved lessons for every two-day timetable from %s to %s', (from, to) => {
    const breaks = tetBreaks(from, to);
    const reserved = maximumWeeklySlots(referenceDate(from), referenceDate(to), breaks);
    const actual = [];
    for (let a = 1; a <= 7; a++)
      for (let b = a + 1; b <= 7; b++)
        actual.push(
          slotsForRange(
            [a, b].map((weekday) => ({ weekday, startTime: '18:00', endTime: '20:00' })),
            from,
            to,
            breaks,
          ).length,
        );
    expect(reserved).toBe(Math.max(...actual));
  });

  it('moves the February 9 catch-up past the entire Tết break', () => {
    const days = makeupCandidateDays({
      sourceStartsAt: localInstant(referenceDate('2026-02-09'), 18),
      startDate: referenceDate('2026-01-12'),
      endDate: referenceDate('2026-04-12'),
      today: referenceDate('2026-02-08'),
      past: false,
    });
    expect(dateOnly(days[0])).toBe('2026-02-24');
    expect(days.map(dateOnly)).not.toContain('2026-02-10');
  });

  it('keeps completed fixtures in the past and respects the exclusive enrollment end', () => {
    const input = {
      sourceStartsAt: localInstant(referenceDate('2026-02-09'), 18),
      startDate: referenceDate('2026-01-12'),
      endDate: referenceDate('2026-04-12'),
      today: referenceDate('2026-02-20'),
      past: true,
    };
    expect(makeupCandidateDays(input)).toEqual([]);
    expect(
      makeupCandidateDays({ ...input, past: false, endDate: referenceDate('2026-02-24') }),
    ).toEqual([]);
  });

  const reader = (afterData: Prisma.JsonObject): Pick<Prisma.TransactionClient, 'auditLog'> =>
    ({ auditLog: { findUnique: jest.fn().mockResolvedValue({ afterData }) } }) as unknown as Pick<
      Prisma.TransactionClient,
      'auditLog'
    >;
  it('rejects outdated demo workflows even when the textbook edition matches', async () => {
    await expect(
      readDemoManifest(
        reader({ version: 2, curriculumEdition: CURRICULUM_EDITION, referenceDate: '2026-11-19' }),
      ),
    ).rejects.toThrow('db:seed:repair');
  });
  it('rejects a dashboard whose date differs from its demo', async () => {
    await expect(
      hasCurrentDashboardManifest(
        reader({
          version: DASHBOARD_SEED_VERSION,
          demoSeedVersion: DEMO_SEED_VERSION,
          curriculumEdition: CURRICULUM_EDITION,
          referenceDate: '2026-11-18',
        }),
        '2026-11-19',
      ),
    ).rejects.toThrow('older seed workflow');
  });
  it('accepts current manifests and preserves their reference date', async () => {
    const data = {
      version: DEMO_SEED_VERSION,
      curriculumEdition: CURRICULUM_EDITION,
      referenceDate: '2026-11-19',
    };
    await expect(readDemoManifest(reader(data), '2026-11-19')).resolves.toEqual(data);
    await expect(readDemoManifest(reader(data), '2026-11-20')).rejects.toThrow(
      'same reference date',
    );
  });
});
