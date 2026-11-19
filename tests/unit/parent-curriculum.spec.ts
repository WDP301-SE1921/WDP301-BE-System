import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import type { DatabaseService } from '../../src/database/orm/database.service';
import type { ParentCurriculumQueryDto } from '../../src/modules/academic/academic-list.dto';
import { CurriculumSchedulingService } from '../../src/modules/curriculum-scheduling/curriculum-scheduling.service';
import type { NotificationEventsService } from '../../src/modules/notifications/notification-events.service';

const NOW = new Date('2026-11-03T08:00:00.000Z');
const PARENT = { id: 'parent-1', role: 'PARENT' } as AuthenticatedUser;
const PAGE = { page: 1, limit: 20 } as ParentCurriculumQueryDto;
const ORIGINAL = { id: 'class-a', name: 'Toán 6A', programId: 'math-6' };
const TRANSFER = { id: 'class-b', name: 'Toán 6B', programId: 'math-6-plus' };

interface Placement {
  effectiveFrom: Date;
  effectiveTo: Date | null;
  class: typeof ORIGINAL;
}

interface UnitQuery {
  where: {
    status?: string;
    programId?: { in: string[] };
    AND?: [unknown, { id: { in: string[] } }];
  };
}

interface Harness {
  service: CurriculumSchedulingService;
  enrollmentQuery: jest.Mock<Promise<unknown[]>, [{ where: Record<string, unknown> }]>;
  /** Unit ids the page query asked for. */
  unitIds: () => string[];
  currentLookups: () => string[][];
}

/**
 * `taught`: unit of each class's latest session. A class without one follows the
 * program's approved version, named `current-<programId>` here.
 */
function setup(
  enrollment: { startDate: Date; endDate: Date; placements: Placement[] },
  taught: Record<string, string> = {},
): Harness {
  const enrollmentQuery = jest.fn<Promise<unknown[]>, [{ where: Record<string, unknown> }]>(() =>
    Promise.resolve([{ ...enrollment, class: ORIGINAL }]),
  );
  const unitQuery = jest.fn<Promise<unknown[]>, [UnitQuery]>(({ where }) => {
    if (where.programId)
      return Promise.resolve(
        where.programId.in.map((programId) => ({ id: `current-${programId}`, programId })),
      );
    const ids = where.AND?.[1].id.in ?? [];
    return Promise.resolve(ids.map((id) => ({ id, programId: 'any', lessons: [] })));
  });
  const db = {
    studentProfile: { count: (): Promise<number> => Promise.resolve(1) },
    enrollment: { findMany: enrollmentQuery },
    classSession: {
      findMany: ({ where }: { where: { classId: { in: string[] } } }): Promise<unknown[]> =>
        Promise.resolve(
          where.classId.in
            .filter((classId) => taught[classId])
            .map((classId) => ({ classId, lesson: { unitId: taught[classId] } })),
        ),
    },
    curriculumUnit: { findMany: unitQuery, count: (): Promise<number> => Promise.resolve(1) },
  };
  const service = new CurriculumSchedulingService(
    db as unknown as DatabaseService,
    {} as NotificationEventsService,
  );
  const calls = (): UnitQuery[] => unitQuery.mock.calls.map(([query]) => query);
  return {
    service,
    enrollmentQuery,
    unitIds: () => calls().find((query) => query.where.AND)?.where.AND?.[1].id.in ?? [],
    currentLookups: () =>
      calls().flatMap((query) => (query.where.programId ? [query.where.programId.in] : [])),
  };
}

describe('parent curriculum outline', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('includes an upcoming term, using the class placed when the term starts', async () => {
    const startDate = new Date('2026-12-01T00:00:00.000Z');
    const { service, enrollmentQuery, unitIds } = setup({
      startDate,
      endDate: new Date('2027-03-01T00:00:00.000Z'),
      placements: [
        { effectiveFrom: new Date('2026-11-30T17:00:00.000Z'), effectiveTo: null, class: TRANSFER },
      ],
    });

    const page = await service.studentCurriculum(PARENT, 'child-1', PAGE);

    expect(enrollmentQuery.mock.calls[0]?.[0].where).not.toHaveProperty('startDate');
    expect(unitIds()).toEqual([`current-${TRANSFER.programId}`]);
    expect(page.items[0]?.classes).toEqual([{ id: TRANSFER.id, name: TRANSFER.name }]);
  });

  it('uses the current placement of an in-term enrollment', async () => {
    const { service, unitIds } = setup({
      startDate: new Date('2026-09-01T00:00:00.000Z'),
      endDate: new Date('2027-01-01T00:00:00.000Z'),
      placements: [
        {
          effectiveFrom: new Date('2026-08-31T17:00:00.000Z'),
          effectiveTo: new Date('2026-10-31T17:00:00.000Z'),
          class: ORIGINAL,
        },
        { effectiveFrom: new Date('2026-10-31T17:00:00.000Z'), effectiveTo: null, class: TRANSFER },
      ],
    });

    await service.studentCurriculum(PARENT, 'child-1', PAGE);

    expect(unitIds()).toEqual([`current-${TRANSFER.programId}`]);
  });

  it('falls back to the class of the registration when there is no placement', async () => {
    const { service, unitIds } = setup({
      startDate: new Date('2026-12-01T00:00:00.000Z'),
      endDate: new Date('2027-03-01T00:00:00.000Z'),
      placements: [],
    });

    await service.studentCurriculum(PARENT, 'child-1', PAGE);

    expect(unitIds()).toEqual([`current-${ORIGINAL.programId}`]);
  });

  it('shows the version a class already teaches, not a newer approved one (Đợt F)', async () => {
    const { service, unitIds, currentLookups } = setup(
      {
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        endDate: new Date('2027-01-01T00:00:00.000Z'),
        placements: [],
      },
      { [ORIGINAL.id]: 'unit-old' },
    );

    const page = await service.studentCurriculum(PARENT, 'child-1', PAGE);

    expect(unitIds()).toEqual(['unit-old']);
    expect(currentLookups()).toEqual([]);
    expect(page.items[0]?.classes).toEqual([{ id: ORIGINAL.id, name: ORIGINAL.name }]);
  });
});
