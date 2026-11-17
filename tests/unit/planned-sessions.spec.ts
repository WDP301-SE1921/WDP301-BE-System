import { plannedSessionCount } from '../../src/modules/registration-flow/planned-sessions';

const day = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

describe('plannedSessionCount', () => {
  it('counts every weekly slot from the start date up to, not including, the end date', () => {
    // 2026-11-02 is a Monday; Monday + Thursday for four weeks is 8 sessions.
    expect(
      plannedSessionCount([{ weekday: 1 }, { weekday: 4 }], day('2026-11-02'), day('2026-11-30')),
    ).toBe(8);
    // The end date itself (Monday 2026-11-30) is outside the term.
    expect(plannedSessionCount([{ weekday: 1 }], day('2026-11-02'), day('2026-11-30'))).toBe(4);
  });

  it('treats weekday 7 as Sunday and counts two slots on the same day twice', () => {
    // 2026-11-08 and 2026-11-15 are Sundays.
    expect(
      plannedSessionCount([{ weekday: 7 }, { weekday: 7 }], day('2026-11-02'), day('2026-11-16')),
    ).toBe(4);
  });

  it('returns null without a usable term', () => {
    expect(plannedSessionCount([{ weekday: 1 }], null, day('2026-11-30'))).toBeNull();
    expect(plannedSessionCount([{ weekday: 1 }], day('2026-11-30'), day('2026-11-02'))).toBeNull();
  });
});
