import { Prisma } from '@prisma/client';

/**
 * A MySQL deadlock (1213) that a retry of the whole transaction can clear. Prisma reports it as
 * P2034 from its own queries, but as P2010 (with the MySQL code in `meta.code`) when it comes
 * from `$queryRaw`, e.g. a hand-written `SELECT … FOR UPDATE`.
 */
export function isRetryableDeadlock(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  const meta = error.meta as { code?: unknown } | undefined;
  return error.code === 'P2010' && String(meta?.code) === '1213';
}
