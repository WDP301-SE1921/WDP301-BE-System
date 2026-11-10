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
 * Weekly slots between two local dates, skipping center closures (B5).
 * `closures` defaults to none so seed data keeps its old calendar.
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

export type ChainSession = { id: string; startsAt: Date; lessonId: string };

export type LessonShift = {
  /** Sessions whose lesson changes, in time order. */
  changes: Array<{ sessionId: string; fromLessonId: string; toLessonId: string }>;
  /** Lessons left without a session of this chain, in teaching order. */
  pushedLessonIds: string[];
};

/**
 * Cancels `cancelledIds` inside one class + curriculum chain and moves every later lesson
 * back by one session per cancelled session (Q1 "Hủy và dời bài sang buổi sau").
 *
 * `chain` holds the cancelled sessions and every scheduled session after the earliest one,
 * all teaching lessons of the same curriculum. The result equals cancelling the sessions
 * one by one in time order, so single and bulk cancellation share it.
 */
export function compactLessons(
  chain: ChainSession[],
  cancelledIds: ReadonlySet<string>,
): LessonShift {
  const ordered = [...chain].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id),
  );
  const first = ordered.findIndex((row) => cancelledIds.has(row.id));
  if (first < 0) return { changes: [], pushedLessonIds: [] };
  const tail = ordered.slice(first);
  const queue = tail.map((row) => row.lessonId);
  const kept = tail.filter((row) => !cancelledIds.has(row.id));
  const changes = kept.flatMap((row, index) =>
    row.lessonId === queue[index]
      ? []
      : [{ sessionId: row.id, fromLessonId: row.lessonId, toLessonId: queue[index] }],
  );
  return { changes, pushedLessonIds: queue.slice(kept.length) };
}

export type PlannableLesson = { id: string; sequence: number };

/**
 * Lessons for the slots of a requested range (C4).
 * - `anchorSequence` set: the class already taught this curriculum before the range, so the
 *   range continues with the lessons after that one.
 * - otherwise: the lesson matches the slot position from the start of the term, closures
 *   excluded, so a class opened mid-term teaches what the other classes teach that week.
 * Returns the lesson queue starting at the first slot of the range.
 */
export function lessonQueue<L extends PlannableLesson>(
  lessons: L[],
  termSlots: DatedSlot[],
  fromDate: string,
  anchorSequence: number | null,
): L[] {
  const ordered = [...lessons].sort((a, b) => a.sequence - b.sequence);
  if (anchorSequence !== null) return ordered.filter((row) => row.sequence > anchorSequence);
  const before = termSlots.filter((slot) => slot.date < fromDate).length;
  return ordered.slice(before);
}
