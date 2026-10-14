import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Workbook } from 'exceljs';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';
import { AppError } from '../../src/common/errors/app.error';
import { AcademicAccessService } from '../../src/modules/academic/academic-access.service';
import { AcademicRepository } from '../../src/modules/academic/academic.repository';
import { AnalyticsBucket, AnalyticsQueryDto } from '../../src/modules/academic/academic.dto';
import { AnalyticsService } from '../../src/modules/academic/analytics.service';

const manager = { id: 'manager', role: 'MANAGER' } as AuthenticatedUser;
const teacher = { id: 'teacher', role: 'TEACHER' } as AuthenticatedUser;
const filters: AnalyticsQueryDto = {
  from: '2026-10-01T00:00:00+07:00',
  to: '2026-10-31T23:59:59.999+07:00',
  bucket: AnalyticsBucket.DAY,
};

interface AnalyticsFixture {
  db: {
    class: { findMany: jest.Mock };
    enrollment: { findMany: jest.Mock };
    classSession: { findMany: jest.Mock };
    gradeReview: { findMany: jest.Mock };
    assignment: { findMany: jest.Mock };
    leaveRequest: { count: jest.Mock };
    makeupBooking: { count: jest.Mock };
    payment: { findMany: jest.Mock };
    lesson: { findMany: jest.Mock };
    curriculumFeedback: { findMany: jest.Mock };
  };
  classroom: jest.Mock<Promise<void>, [AuthenticatedUser, string]>;
  service: AnalyticsService;
}

function setup(): AnalyticsFixture {
  const db = {
    class: {
      findMany: jest.fn().mockResolvedValue([{ id: 'class', name: 'Toán 8', capacity: 10 }]),
    },
    enrollment: { findMany: jest.fn().mockResolvedValue([]) },
    classSession: { findMany: jest.fn().mockResolvedValue([]) },
    gradeReview: { findMany: jest.fn().mockResolvedValue([]) },
    assignment: { findMany: jest.fn().mockResolvedValue([]) },
    leaveRequest: { count: jest.fn().mockResolvedValue(2) },
    makeupBooking: { count: jest.fn().mockResolvedValue(3) },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
    lesson: { findMany: jest.fn().mockResolvedValue([]) },
    curriculumFeedback: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const classroom = jest
    .fn<Promise<void>, [AuthenticatedUser, string]>()
    .mockResolvedValue(undefined);
  const service = new AnalyticsService(
    { db } as unknown as AcademicRepository,
    { classroom } as unknown as AcademicAccessService,
  );
  return { db, classroom, service };
}

describe('role-scoped analytics', () => {
  beforeEach(() =>
    jest
      .useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
      .setSystemTime(new Date('2026-10-14T10:00:00Z')),
  );
  afterEach(() => jest.useRealTimers());

  it.each(['STAFF', 'PARENT'] as const)('rejects %s before reading any data', async (role) => {
    const { service, db } = setup();
    await expect(service.dashboard({ ...manager, role }, filters)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    expect(db.class.findMany).not.toHaveBeenCalled();
    expect(db.payment.findMany).not.toHaveBeenCalled();
  });

  it('restricts teacher classes and omits manager finance/leave data', async () => {
    const { service, db } = setup();
    await expect(service.dashboard(teacher, filters)).resolves.toMatchObject({
      role: 'TEACHER',
      summary: { classes: 1 },
    });
    const args = db.class.findMany.mock.calls[0] as unknown[];
    expect(args[0]).toMatchObject({
      where: {
        OR: [
          expect.objectContaining({ teacherId: teacher.id }),
          expect.objectContaining({ pendingTeacherId: teacher.id }),
        ],
      },
    });
    expect(db.payment.findMany).not.toHaveBeenCalled();
    expect(db.leaveRequest.count).not.toHaveBeenCalled();
    expect(db.makeupBooking.count).not.toHaveBeenCalled();
  });

  it('checks class ownership before querying its analytics', async () => {
    const { service, db, classroom } = setup();
    classroom.mockRejectedValue(new AppError('FORBIDDEN', 'Unassigned class', 403));
    await expect(
      service.dashboard(teacher, { ...filters, classId: 'other' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(db.class.findMany).not.toHaveBeenCalled();
    expect(db.enrollment.findMany).not.toHaveBeenCalled();
  });

  it('limits manager payments to the selected class and selected confirmation dates', async () => {
    const { service, db } = setup();
    await service.dashboard(manager, { ...filters, classId: 'class' });
    expect(db.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'CONFIRMED',
          registrationOrder: { classId: 'class' },
          confirmedAt: { gte: new Date(filters.from), lte: new Date(filters.to) },
        },
      }),
    );
  });

  it.each([
    { from: '2026-11-01T00:00:00Z' },
    { from: 'invalid' },
    { from: '2025-01-01T00:00:00Z' },
  ])('rejects invalid or excessive date ranges %j without queries', async (override) => {
    const { service, db } = setup();
    await expect(service.dashboard(manager, { ...filters, ...override })).rejects.toMatchObject({
      code: 'INVALID_ANALYTICS_RANGE',
    });
    expect(db.class.findMany).not.toHaveBeenCalled();
  });

  it('uses Vietnam calendar days and counts a completed makeup once in attendance', async () => {
    const { service, db } = setup();
    const at = new Date('2026-10-01T17:30:00Z'); // 00:30 on 2 October in Vietnam.
    db.payment.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal(2400000), confirmedAt: at },
    ]);
    db.classSession.findMany.mockResolvedValue([
      {
        classId: 'class',
        startsAt: at,
        status: 'COMPLETED',
        participants: [
          { attendance: 'PRESENT', sourceBookings: [] },
          { attendance: 'ABSENT', sourceBookings: [{ id: 'makeup' }] },
          { attendance: 'EXCUSED', sourceBookings: [] },
        ],
      },
    ]);
    await expect(
      service.dashboard(manager, { ...filters, to: '2026-10-02T23:59:59.999+07:00' }),
    ).resolves.toMatchObject({
      summary: { confirmedRevenue: 2400000, completedSessions: 1, attendancePercent: 100 },
      trend: [
        expect.objectContaining({
          period: '2026-10-01',
          confirmedRevenue: 0,
          completedSessions: 0,
        }),
        expect.objectContaining({
          period: '2026-10-02',
          confirmedRevenue: 2400000,
          attendanceRequired: 2,
          attendanceSatisfied: 2,
          completedSessions: 1,
        }),
      ],
    });
  });

  it('includes each local month across different month lengths and year boundaries', async () => {
    const { service, db } = setup();
    const periods = [
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
    ];
    db.payment.findMany.mockResolvedValue(
      periods.map((period, index) => ({
        amount: new Prisma.Decimal((index + 1) * 100000),
        confirmedAt: new Date(`${period}T00:00:00+07:00`),
      })),
    );
    const result = await service.dashboard(manager, {
      from: '2025-12-01T00:00:00+07:00',
      to: '2026-05-31T23:59:59.999+07:00',
      bucket: AnalyticsBucket.MONTH,
    });
    expect(result.trend).toMatchObject(
      periods.map((period, index) => ({ period, confirmedRevenue: (index + 1) * 100000 })),
    );
  });

  it('does not count an expired term or a student whose current placement is outside the class', async () => {
    jest.setSystemTime(new Date('2026-10-13T18:00:00Z')); // Local 14 October, before 00:00Z.
    const { service, db } = setup();
    const base = {
      id: 'enrollment',
      classId: 'class',
      status: 'ACTIVE',
      studentProfileId: 'student',
      startDate: new Date('2026-10-01T00:00:00Z'),
      endDate: new Date('2026-11-01T00:00:00Z'),
      placements: [],
    };
    db.enrollment.findMany.mockResolvedValue([
      { ...base, endDate: new Date('2026-10-14T00:00:00Z') },
      {
        ...base,
        id: 'moved',
        placements: [
          { classId: 'outside', effectiveFrom: new Date('2026-10-10'), effectiveTo: null },
        ],
      },
    ]);
    await expect(
      service.dashboard(manager, { ...filters, classId: 'class' }),
    ).resolves.toMatchObject({
      summary: { activeStudents: 0, reservedSeats: 0 },
      classes: [expect.objectContaining({ reservedSeats: 0 })],
    });
  });

  it('counts published scores as percentages and includes unpublished submissions separately', async () => {
    const { service, db } = setup();
    db.gradeReview.findMany.mockResolvedValue([
      {
        totalScore: 15,
        publishedAt: new Date('2026-10-02T10:00:00Z'),
        submission: {
          recipient: { assignment: { classId: 'class', questions: [{ maxScore: 20 }] } },
        },
      },
    ]);
    db.assignment.findMany.mockResolvedValue([
      {
        classId: 'class',
        recipients: [
          {
            submissions: [{ grades: [{ status: 'PUBLISHED' }] }, { grades: [{ status: 'DRAFT' }] }],
          },
        ],
      },
    ]);
    await expect(service.dashboard(teacher, filters)).resolves.toMatchObject({
      summary: { publishedGrades: 1, averageScore: 75, unpublishedSubmissions: 1 },
    });
  });

  it('exports a real workbook with the selected range, classes and revenue series', async () => {
    const { service, db } = setup();
    db.payment.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal(2400000), confirmedAt: new Date('2026-10-02T10:00:00Z') },
    ]);
    const exported = await service.exportDashboard(manager, {
      ...filters,
      bucket: AnalyticsBucket.MONTH,
    });
    expect(exported.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(exported.name).toMatch(/^analytics-manager-2026-10-14\.xlsx$/);
    const workbook = new Workbook();
    await workbook.xlsx.load(
      exported.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Overview',
      'Classes',
      'Trend',
    ]);
    expect(workbook.getWorksheet('Trend')?.getRow(2).values).toEqual(
      expect.arrayContaining(['2026-10-01', 2400000]),
    );
  });

  it('validates unsupported buckets and malformed instants at the HTTP DTO boundary', async () => {
    const input = plainToInstance(AnalyticsQueryDto, {
      from: 'yesterday',
      to: filters.to,
      bucket: 'YEAR',
    });
    const errors = await validate(input);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['from', 'bucket']),
    );
  });
});
