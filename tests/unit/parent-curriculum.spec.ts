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
  where: { AND: [unknown, { OR: { programId: string }[] }] };
}

interface Harness {
  service: CurriculumSchedulingService;
  enrollmentQuery: jest.Mock<Promise<unknown[]>, [{ where: Record<string, unknown> }]>;
  programs: () => string[];
}

function setup(enrollment: { startDate: Date; endDate: Date; placements: Placement[] }): Harness {
  const enrollmentQuery = jest.fn<Promise<unknown[]>, [{ where: Record<string, unknown> }]>(() =>
    Promise.resolve([{ ...enrollment, class: ORIGINAL }]),
  );
  const unitQuery = jest.fn<Promise<unknown[]>, [UnitQuery]>(() =>
    Promise.resolve([
      {
        id: 'unit-1',
        programId: enrollment.placements.at(-1)?.class.programId ?? ORIGINAL.programId,
        fromDate: enrollment.startDate,
        toDate: enrollment.endDate,
        lessons: [],
      },
    ]),
  );
  const db = {
    studentProfile: { count: (): Promise<number> => Promise.resolve(1) },
    enrollment: { findMany: enrollmentQuery },
    curriculumUnit: { findMany: unitQuery, count: (): Promise<number> => Promise.resolve(1) },
  };
  const service = new CurriculumSchedulingService(
    db as unknown as DatabaseService,
    {} as NotificationEventsService,
  );
  const programs = (): string[] =>
    unitQuery.mock.calls[0]?.[0].where.AND[1].OR.map(({ programId }) => programId) ?? [];
  return { service, enrollmentQuery, programs };
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
    const { service, enrollmentQuery, programs } = setup({
      startDate,
      endDate: new Date('2027-03-01T00:00:00.000Z'),
      placements: [
        { effectiveFrom: new Date('2026-11-30T17:00:00.000Z'), effectiveTo: null, class: TRANSFER },
      ],
    });

    const page = await service.studentCurriculum(PARENT, 'child-1', PAGE);

    expect(enrollmentQuery.mock.calls[0]?.[0].where).not.toHaveProperty('startDate');
    expect(programs()).toEqual([TRANSFER.programId]);
    expect(page.items[0]?.classes).toEqual([{ id: TRANSFER.id, name: TRANSFER.name }]);
  });

  it('uses the current placement of an in-term enrollment', async () => {
    const { service, programs } = setup({
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

    expect(programs()).toEqual([TRANSFER.programId]);
  });

  it('falls back to the class of the registration when there is no placement', async () => {
    const { service, programs } = setup({
      startDate: new Date('2026-12-01T00:00:00.000Z'),
      endDate: new Date('2027-03-01T00:00:00.000Z'),
      placements: [],
    });

    await service.studentCurriculum(PARENT, 'child-1', PAGE);

    expect(programs()).toEqual([ORIGINAL.programId]);
  });
});
