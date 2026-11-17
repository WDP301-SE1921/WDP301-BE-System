const DAY_MS = 86_400_000;

/**
 * Sessions the weekly schedule plans from `startDate` (inclusive) to `endDate` (exclusive).
 * Both are calendar dates stored at UTC midnight; `weekday` is ISO (1 = Monday, 7 = Sunday).
 * Center days off and cancelled sessions are not subtracted: this is the plan a monthly fee is
 * quoted against, so a bill can say "3 months ≈ 26 sessions".
 */
export function plannedSessionCount(
  schedules: ReadonlyArray<{ weekday: number }>,
  startDate: Date | null,
  endDate: Date | null,
): number | null {
  if (!startDate || !endDate || endDate <= startDate) return null;
  const perWeekday = new Map<number, number>();
  for (const slot of schedules) perWeekday.set(slot.weekday, (perWeekday.get(slot.weekday) ?? 0) + 1);
  let count = 0;
  for (let time = startDate.getTime(); time < endDate.getTime(); time += DAY_MS) {
    const day = new Date(time).getUTCDay();
    count += perWeekday.get(day === 0 ? 7 : day) ?? 0;
  }
  return count;
}
