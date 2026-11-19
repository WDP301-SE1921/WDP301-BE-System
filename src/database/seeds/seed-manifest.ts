import type { Prisma } from '@prisma/client';
import { CURRICULUM_EDITION } from './curriculum-content';
import { dateOnly, demoId, referenceDate } from './seed-calendar';

export const DEMO_SEED_VERSION = 3;
export const DASHBOARD_SEED_VERSION = 2;
export const DASHBOARD_MANIFEST_ID = 'seed_bulk_v1_manifest';

type ManifestReader = Pick<Prisma.TransactionClient, 'auditLog'>;

export interface DemoManifest {
  referenceDate: string;
  version: number;
  curriculumEdition: string;
}

export function manifestData(value: Prisma.JsonValue | null): Prisma.JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Shared by both entry points; compatibility is checked before writing any demo data. */
export async function readDemoManifest(
  db: ManifestReader,
  requestedDate?: string,
): Promise<DemoManifest | undefined> {
  const manifest = await db.auditLog.findUnique({ where: { id: demoId('manifest') } });
  if (!manifest) return undefined;
  const data = manifestData(manifest.afterData);
  if (data.curriculumEdition !== CURRICULUM_EDITION)
    throw new Error(
      'This demo uses an older curriculum edition. Preview pnpm db:seed:curriculum to add sourced drafts, or use a fresh development database. Existing curricula were preserved.',
    );
  if (data.version !== DEMO_SEED_VERSION)
    throw new Error(
      'This demo uses an older seed workflow. Run pnpm db:seed:repair to review compatible repairs before using --apply. Confirmed bills and completed sessions are preserved.',
    );
  if (typeof data.referenceDate !== 'string')
    throw new Error('Demo manifest has no reference date.');
  const storedDate = dateOnly(referenceDate(data.referenceDate));
  if (requestedDate && dateOnly(referenceDate(requestedDate)) !== storedDate)
    throw new Error(
      `Demo already uses SEED_REFERENCE_DATE=${storedDate}; use the same reference date.`,
    );
  return {
    referenceDate: storedDate,
    version: DEMO_SEED_VERSION,
    curriculumEdition: CURRICULUM_EDITION,
  };
}

export async function hasCurrentDashboardManifest(
  db: ManifestReader,
  expectedDate?: string,
): Promise<boolean> {
  const manifest = await db.auditLog.findUnique({ where: { id: DASHBOARD_MANIFEST_ID } });
  if (!manifest) return false;
  const data = manifestData(manifest.afterData);
  if (
    data.version !== DASHBOARD_SEED_VERSION ||
    data.curriculumEdition !== CURRICULUM_EDITION ||
    data.demoSeedVersion !== DEMO_SEED_VERSION ||
    (expectedDate !== undefined && data.referenceDate !== expectedDate)
  )
    throw new Error(
      'This dashboard uses an older seed workflow. Review pnpm db:seed:repair first.',
    );
  return true;
}
