const DAY_MS = 86_400_000;
const OFFSET_MS = 7 * 3_600_000;

export const DEMO_PREFIX = 'seed_demo_v1_';

export function demoId(key: string): string {
  return `${DEMO_PREFIX}${key}`;
}

/** Date-only values use UTC midnight; session/placement instants use Vietnam time. */
export function referenceDate(value?: string, now = new Date()): Date {
  const text = value ?? new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text))
    throw new Error('SEED_REFERENCE_DATE must be a valid YYYY-MM-DD date.');
  const date = new Date(`${text}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text)
    throw new Error('SEED_REFERENCE_DATE must be a valid YYYY-MM-DD date.');
  return date;
}

export function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addMonths(date: Date, months: number): Date {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return first;
}

export function monthStart(date: Date, offset = 0): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}

export function localInstant(date: Date, hour = 0, minute = 0): Date {
  return new Date(date.getTime() - OFFSET_MS + (hour * 60 + minute) * 60_000);
}

export function studyDay(instant: Date): Date {
  return referenceDate(new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 10));
}
