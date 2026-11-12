/** ISO weekday (Monday 1 ... Sunday 7) the way Vietnamese parents read it: Monday is "Thứ 2". */
const WEEKDAY_NAMES: Record<number, string> = {
  1: 'Thứ 2',
  2: 'Thứ 3',
  3: 'Thứ 4',
  4: 'Thứ 5',
  5: 'Thứ 6',
  6: 'Thứ 7',
  7: 'Chủ nhật',
};

const MONEY = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

export function weekdayName(isoWeekday: number): string {
  return WEEKDAY_NAMES[isoWeekday] ?? `Thứ ${isoWeekday}`;
}

/** Weekly slots in week order, e.g. `Thứ 2, 18:00-19:30; Chủ nhật, 08:00-09:30`. */
export function weeklySlotsText(
  slots: ReadonlyArray<{ weekday: number; startTime: string; endTime: string }>,
): string {
  return [...slots]
    .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
    .map((slot) => `${weekdayName(slot.weekday)}, ${slot.startTime}-${slot.endTime}`)
    .join('; ');
}

/** Amount with Vietnamese digit grouping, e.g. `1.500.000 VND` (Prisma Decimal prints `1500000`). */
export function moneyText(amount: { toString(): string } | number, currency: string): string {
  return `${MONEY.format(Number(amount.toString()))} ${currency}`;
}
