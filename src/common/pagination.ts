export interface PageRequest {
  page: number;
  limit: number;
  paginated?: boolean;
}

/** Opt-in metadata preserves the array contract used by existing clients. */
export async function pageResult<T>(
  query: PageRequest,
  items: Promise<T[]>,
  count: () => Promise<number>,
): Promise<T[] | { items: T[]; page: number; limit: number; total: number }> {
  if (!query.paginated) return items;
  const [rows, total] = await Promise.all([items, count()]);
  return { items: rows, page: query.page, limit: query.limit, total };
}
