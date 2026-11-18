/** Inclusive range of local (UTC+7) dates, `YYYY-MM-DD`. */
export type DateRange = { fromDate: string; toDate: string };

/**
 * Mùng 1 Tết by year, local dates of the Vietnamese lunar calendar (UTC+7). Add the next years
 * before 2035 together with `TET_BREAKS`. 2030 is 02-02 in Vietnam (02-03 in China).
 */
export const LUNAR_NEW_YEAR: readonly string[] = [
  '2025-01-29',
  '2026-02-17',
  '2027-02-06',
  '2028-01-26',
  '2029-02-13',
  '2030-02-02',
  '2031-01-23',
  '2032-02-11',
  '2033-01-31',
  '2034-02-19',
  '2035-02-08',
];

/**
 * The center's Tết break, one row per entry of `LUNAR_NEW_YEAR`: from 23 tháng Chạp (đưa ông
 * Táo về trời) through mùng 7. Schedule generation makes no session inside it, so the next
 * lesson lands on the first class day after Tết. 23 Chạp is 7 or 8 days before mùng 1
 * depending on the length of tháng Chạp, so the dates are listed, not computed.
 */
export const TET_BREAKS: readonly DateRange[] = [
  { fromDate: '2025-01-22', toDate: '2025-02-04' },
  { fromDate: '2026-02-10', toDate: '2026-02-23' },
  { fromDate: '2027-01-30', toDate: '2027-02-12' },
  { fromDate: '2028-01-19', toDate: '2028-02-01' },
  { fromDate: '2029-02-06', toDate: '2029-02-19' },
  { fromDate: '2030-01-26', toDate: '2030-02-08' },
  { fromDate: '2031-01-16', toDate: '2031-01-29' },
  { fromDate: '2032-02-04', toDate: '2032-02-17' },
  { fromDate: '2033-01-23', toDate: '2033-02-06' },
  { fromDate: '2034-02-11', toDate: '2034-02-25' },
  { fromDate: '2035-01-31', toDate: '2035-02-14' },
];

/** Tết breaks that overlap the local dates `[from, to]`. */
export function tetBreaks(from: string, to: string): DateRange[] {
  return TET_BREAKS.filter((row) => row.fromDate <= to && row.toDate >= from).map((row) => ({
    ...row,
  }));
}
