import { HttpStatus } from '@nestjs/common';
import { AppError } from './errors/app.error';
import type { PageRequest } from './pagination';

/** Date-only bounds include the entire UTC+7 center day; timestamps remain exact. */
export function dateTimeRange(fromDate?: string, toDate?: string): { gte?: Date; lte?: Date } {
  const parse = (value: string, endOfDay: boolean): Date => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const utc = new Date(value);
      if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== value)
        throw new AppError(
          'INVALID_DATE_RANGE',
          'Use a valid calendar date',
          HttpStatus.BAD_REQUEST,
        );
      return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}+07:00`);
    }
    // A timestamp without a zone denotes center-local time, never the server host zone.
    return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}+07:00`);
  };
  const start = fromDate ? parse(fromDate, false) : undefined;
  const end = toDate ? parse(toDate, true) : undefined;
  if (
    (start && !Number.isFinite(start.getTime())) ||
    (end && !Number.isFinite(end.getTime())) ||
    (start && end && start > end)
  )
    throw new AppError(
      'INVALID_DATE_RANGE',
      'fromDate must be before or equal to toDate',
      HttpStatus.BAD_REQUEST,
    );
  return { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
}

/** For small computed collections (weekly slots / eligibility), filter before slicing. */
export function pageArray<T>(
  rows: T[],
  query: PageRequest,
): T[] | { items: T[]; page: number; limit: number; total: number } {
  const items = rows.slice((query.page - 1) * query.limit, query.page * query.limit);
  return query.paginated
    ? { items, page: query.page, limit: query.limit, total: rows.length }
    : items;
}
