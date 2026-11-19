import type { ClassWeeklySchedule } from '@prisma/client';

const DAY_MS = 86_400_000;
const HCM_OFFSET_MS = 7 * 3_600_000;

/** Inclusive range of local (UTC+7) dates, `YYYY-MM-DD`. */
export type ClosureRange = { fromDate: string; toDate: string };

export type DatedSlot = { date: string; startsAt: Date; endsAt: Date };

function localDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dayString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Local (UTC+7) calendar date of an instant. */
export function vietnamDate(value: Date): string {
  return dayString(new Date(value.getTime() + HCM_OFFSET_MS));
}

/** UTC instant of 00:00 (UTC+7) on a local date. */
export function vietnamDayStart(value: string): Date {
  return new Date(localDay(value).getTime() - HCM_OFFSET_MS);
}

export function isClosed(date: string, closures: readonly ClosureRange[]): boolean {
  return closures.some((closure) => closure.fromDate <= date && date <= closure.toDate);
}

/**
 * Weekly slots between two local dates, skipping `closures` (the Tết breaks, see
 * `common/lunar-new-year`). `closures` defaults to none.
 */
export function slotsForRange(
  schedules: Array<Pick<ClassWeeklySchedule, 'weekday' | 'startTime' | 'endTime'>>,
  from: string,
  to: string,
  closures: readonly ClosureRange[] = [],
): DatedSlot[] {
  const result: DatedSlot[] = [];
  for (let day = localDay(from); day <= localDay(to); day = new Date(day.getTime() + DAY_MS)) {
    const date = dayString(day);
    if (isClosed(date, closures)) continue;
    const weekday = day.getUTCDay() || 7;
    for (const schedule of schedules.filter((item) => item.weekday === weekday)) {
      const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
      const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
      result.push({
        date,
        startsAt: new Date(day.getTime() + (startHour * 60 + startMinute) * 60_000 - HCM_OFFSET_MS),
        endsAt: new Date(day.getTime() + (endHour * 60 + endMinute) * 60_000 - HCM_OFFSET_MS),
      });
    }
  }
  return result.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export type PlannableLesson = { id: string; sequence: number };

/** A class schedule never runs longer than this many months from its start date. */
export const MAX_SCHEDULE_MONTHS = 24;

/** Local date `months` calendar months after `from` (clamped to the end of a short month). */
export function addMonthsLocal(from: string, months: number): string {
  const base = localDay(from);
  const target = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(base.getUTCDate(), lastDay));
  return dayString(target);
}

/** Last local date a schedule starting on `from` may reach. */
export function scheduleLimit(from: string): string {
  return addMonthsLocal(from, MAX_SCHEDULE_MONTHS);
}

/**
 * Lessons still to teach (D1): lesson 1.. for a new class, the lessons after
 * `anchorSequence` for a class that already taught this curriculum.
 */
export function remainingLessons<L extends PlannableLesson>(
  lessons: L[],
  anchorSequence: number | null,
): L[] {
  const ordered = [...lessons].sort((a, b) => a.sequence - b.sequence);
  return anchorSequence === null ? ordered : ordered.filter((row) => row.sequence > anchorSequence);
}

/**
 * One remaining lesson per weekly slot from `fromDate`, Tết `closures` skipped, until no
 * lesson is left. `tooLong`: the lessons do not fit within 24 months.
 */
export function planLessonSlots<L extends PlannableLesson>(
  lessons: L[],
  schedules: Array<Pick<ClassWeeklySchedule, 'weekday' | 'startTime' | 'endTime'>>,
  fromDate: string,
  closures: readonly ClosureRange[],
  anchorSequence: number | null,
): { slots: Array<DatedSlot & { lesson: L }>; remaining: L[]; tooLong: boolean } {
  const remaining = remainingLessons(lessons, anchorSequence);
  const available = slotsForRange(schedules, fromDate, scheduleLimit(fromDate), closures);
  const slots = available.slice(0, remaining.length).map((slot, index) => ({
    ...slot,
    lesson: remaining[index],
  }));
  return { slots, remaining, tooLong: slots.length < remaining.length };
}
