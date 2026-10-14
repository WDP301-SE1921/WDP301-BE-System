import {
  addMonths,
  localInstant,
  referenceDate,
  studyDay,
} from '../../src/database/seeds/seed-calendar';

describe('Demo calendar', () => {
  it('uses the Vietnam date at a UTC day boundary', () => {
    expect(referenceDate(undefined, new Date('2026-10-13T18:00:00Z')).toISOString()).toBe(
      '2026-10-14T00:00:00.000Z',
    );
    expect(localInstant(referenceDate('2026-10-14'), 18).toISOString()).toBe(
      '2026-10-14T11:00:00.000Z',
    );
    expect(studyDay(new Date('2026-10-13T18:00:00Z')).toISOString()).toBe(
      '2026-10-14T00:00:00.000Z',
    );
  });
  it('clamps calendar months and handles leap years and year transitions', () => {
    expect(addMonths(referenceDate('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addMonths(referenceDate('2024-01-31'), 1).toISOString().slice(0, 10)).toBe('2024-02-29');
    expect(addMonths(referenceDate('2026-12-31'), 1).toISOString().slice(0, 10)).toBe('2027-01-31');
  });
  it.each(['2026-02-30', '2026-13-01', '14/10/2026', '2026-1-01'])(
    'rejects impossible or ambiguous reference date %s',
    (date) => {
      expect(() => referenceDate(date)).toThrow('SEED_REFERENCE_DATE');
    },
  );
});
