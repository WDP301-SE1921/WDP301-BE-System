import type { NotificationEventsService } from '../../src/modules/notifications/notification-events.service';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import type { AcademicAccessService } from '../../src/modules/academic/academic-access.service';
import type { SessionDto } from '../../src/modules/academic/academic.dto';
import type { AcademicRepository } from '../../src/modules/academic/academic.repository';
import { CatalogService } from '../../src/modules/academic/catalog.service';

const manager = { id: 'manager', role: 'MANAGER' } as AuthenticatedUser;
const designer = { id: 'designer', role: 'CURRICULUM_DESIGNER' } as AuthenticatedUser;
const session: SessionDto = {
  classId: 'class',
  teacherId: 'teacher',
  lessonId: 'lesson',
  startsAt: '2099-11-01T10:00:00Z',
  endsAt: '2099-11-01T12:00:00Z',
};
const legacyLesson = {
  id: 'lesson',
  programId: 'program',
  designerId: designer.id,
  sequence: 1,
  status: 'APPROVED',
  kind: 'LESSON',
  unitId: null,
  unit: null,
};
const approvedUnit = {
  status: 'APPROVED',
  fromDate: new Date('2099-11-01T00:00:00Z'),
  toDate: new Date('2099-11-30T00:00:00Z'),
};

describe('legacy lesson endpoints respect the complete curriculum workflow', () => {
  const findLesson = jest.fn();
  const updateLesson = jest.fn();
  const createLesson = jest.fn();
  const createSession = jest.fn();
  let service: CatalogService;

  beforeEach(() => {
    jest.clearAllMocks();
    findLesson.mockResolvedValue(legacyLesson);
    updateLesson.mockResolvedValue(legacyLesson);
    createSession.mockResolvedValue({ id: 'session' });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      lesson: { findUniqueOrThrow: findLesson, update: updateLesson, create: createLesson },
      class: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'class',
          programId: 'program',
          isOpen: true,
          roomId: null,
          program: { id: 'program', sessionsPerWeek: 1 },
          weeklySchedules: [{ weekday: 1, startTime: '18:00', endTime: '20:00' }],
        }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'teacher' }) },
      classSession: { count: jest.fn().mockResolvedValue(0), create: createSession },
    };
    service = new CatalogService(
      {
        db: tx,
        transaction: (work: (db: Prisma.TransactionClient) => Promise<unknown>): Promise<unknown> =>
          work(tx as unknown as Prisma.TransactionClient),
      } as unknown as AcademicRepository,
      {} as AcademicAccessService,
      {
        curriculum: jest.fn(),
        schedule: jest.fn(),
        assignment: jest.fn(),
      } as unknown as NotificationEventsService,
    );
  });

  it.each(['DRAFT', 'PENDING_REVIEW', 'ARCHIVED'])(
    'cannot approve a single lesson from a %s curriculum',
    async (status) => {
      findLesson.mockResolvedValue({ ...legacyLesson, unitId: 'unit', unit: { status } });
      await expect(service.approveLesson(manager, 'lesson')).rejects.toMatchObject({
        code: 'UNIT_APPROVAL_REQUIRED',
      });
      expect(updateLesson).not.toHaveBeenCalled();
    },
  );

  it.each(['DRAFT', 'PENDING_REVIEW', 'ARCHIVED'])(
    'cannot schedule an individually approved lesson from a %s curriculum',
    async (status) => {
      findLesson.mockResolvedValue({ ...legacyLesson, unitId: 'unit', unit: { status } });
      await expect(service.createSession(manager, session)).rejects.toMatchObject({
        code: 'UNIT_APPROVAL_REQUIRED',
      });
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it('keeps standalone legacy lesson approval, revision and scheduling available', async () => {
    await service.approveLesson(manager, 'lesson');
    await service.reviseLesson(designer, 'lesson', { title: 'Revised', content: 'Examples' });
    await service.createSession(manager, session);
    expect(updateLesson).toHaveBeenCalledWith({
      where: { id: 'lesson' },
      data: { status: 'APPROVED' },
    });
    expect(createLesson).toHaveBeenCalledWith({
      data: {
        title: 'Revised',
        content: 'Examples',
        programId: 'program',
        designerId: designer.id,
        sequence: 1,
        basedOnId: 'lesson',
      },
    });
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('can schedule an approved regular lesson after complete curriculum confirmation', async () => {
    findLesson.mockResolvedValue({
      ...legacyLesson,
      unitId: 'unit',
      unit: approvedUnit,
    });
    await service.createSession(manager, session);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('requires a whole-unit future revision for a lesson belonging to a curriculum', async () => {
    findLesson.mockResolvedValue({ ...legacyLesson, unitId: 'unit' });
    await expect(
      service.reviseLesson(designer, 'lesson', {
        title: 'Independent revision',
        content: 'Content',
      }),
    ).rejects.toMatchObject({ code: 'UNIT_REVISION_REQUIRED' });
    expect(createLesson).not.toHaveBeenCalled();
  });

  it.each([
    ['2099-10-31T16:59:00Z', '2099-10-31T18:00:00Z'],
    ['2099-11-30T16:00:00Z', '2099-11-30T17:00:01Z'],
  ])(
    'blocks legacy sessions outside inclusive Vietnam curriculum dates (%s)',
    async (startsAt, endsAt) => {
      findLesson.mockResolvedValue({ ...legacyLesson, unitId: 'unit', unit: approvedUnit });
      await expect(
        service.createSession(manager, { ...session, startsAt, endsAt }),
      ).rejects.toMatchObject({ code: 'RANGE_OUTSIDE_UNIT' });
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['2099-10-31T17:00:00Z', '2099-10-31T18:00:00Z'],
    ['2099-11-30T16:00:00Z', '2099-11-30T17:00:00Z'],
  ])('accepts legacy sessions on the Vietnam period boundary (%s)', async (startsAt, endsAt) => {
    findLesson.mockResolvedValue({ ...legacyLesson, unitId: 'unit', unit: approvedUnit });
    await service.createSession(manager, { ...session, startsAt, endsAt });
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('cannot create new curriculum test sessions from old monthly test records', async () => {
    findLesson.mockResolvedValue({
      ...legacyLesson,
      kind: 'MONTHLY_TEST',
      unitId: 'unit',
      unit: { status: 'APPROVED' },
    });
    await expect(service.createSession(manager, session)).rejects.toMatchObject({
      code: 'TESTS_MANAGED_BY_TEACHER',
    });
    expect(createSession).not.toHaveBeenCalled();
  });
});
