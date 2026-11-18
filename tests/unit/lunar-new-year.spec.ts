import { LUNAR_NEW_YEAR, TET_BREAKS, tetBreaks } from '../../src/common/lunar-new-year';

const DAY = 86_400_000;
const shift = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

describe('Tết break: 23 tháng Chạp (ông Táo) through mùng 7', () => {
  it('lists the break of 2027 as 30/01 – 12/02', () => {
    expect(tetBreaks('2027-01-01', '2027-12-31')).toEqual([
      { fromDate: '2027-01-30', toDate: '2027-02-12' },
    ]);
  });

  it('ends every break on mùng 7 and starts it 7 or 8 days before mùng 1', () => {
    expect(TET_BREAKS).toHaveLength(LUNAR_NEW_YEAR.length);
    TET_BREAKS.forEach((row, index) => {
      expect(row.toDate).toBe(shift(LUNAR_NEW_YEAR[index], 6));
      expect([shift(LUNAR_NEW_YEAR[index], -7), shift(LUNAR_NEW_YEAR[index], -8)]).toContain(
        row.fromDate,
      );
    });
  });

  it('keeps a break that only partly overlaps the range', () => {
    expect(tetBreaks('2027-02-12', '2027-03-01')).toEqual([
      { fromDate: '2027-01-30', toDate: '2027-02-12' },
    ]);
    expect(tetBreaks('2027-01-01', '2027-01-30')).toEqual([
      { fromDate: '2027-01-30', toDate: '2027-02-12' },
    ]);
  });

  it('returns nothing for a range without Tết', () => {
    expect(tetBreaks('2027-02-13', '2027-12-31')).toEqual([]);
    expect(tetBreaks('2027-01-01', '2027-01-29')).toEqual([]);
  });

  it('returns one break per year across years', () => {
    expect(tetBreaks('2026-01-01', '2027-12-31')).toEqual([
      { fromDate: '2026-02-10', toDate: '2026-02-23' },
      { fromDate: '2027-01-30', toDate: '2027-02-12' },
    ]);
  });
});
