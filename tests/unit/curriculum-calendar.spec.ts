import type { NotificationEventsService } from '../../src/modules/notifications/notification-events.service';
import {
  lastMonthlySlots,
  slotsForRange,
  CurriculumSchedulingService,
} from '../../src/modules/curriculum-scheduling/curriculum-scheduling.service';
import type { DatabaseService } from '../../src/database/orm/database.service';
import type { AuthenticatedUser } from '../../src/common/types/authenticated-user';

describe('weekly session calendar', () => {
  it('generates different class days in Vietnam time for the same week', () => {
    const classA = slotsForRange(
      [1, 3, 5].map((weekday) => ({ weekday, startTime: '18:00', endTime: '20:00' })),
      '2027-01-04',
      '2027-01-10',
    );
    const classB = slotsForRange(
      [2, 4, 6].map((weekday) => ({ weekday, startTime: '18:00', endTime: '20:00' })),
      '2027-01-04',
      '2027-01-10',
    );
    expect(classA.map((slot) => slot.date)).toEqual(['2027-01-04', '2027-01-06', '2027-01-08']);
    expect(classB.map((slot) => slot.date)).toEqual(['2027-01-05', '2027-01-07', '2027-01-09']);
    expect(classA[0].startsAt.toISOString()).toBe('2027-01-04T11:00:00.000Z');
    expect(classA[0].endsAt.toISOString()).toBe('2027-01-04T13:00:00.000Z');
  });

  it('marks the final scheduled slot of each calendar month, including a partial month', () => {
    const slots = slotsForRange(
      [{ weekday: 7, startTime: '08:00', endTime: '10:00' }],
      '2027-01-29',
      '2027-02-08',
    );
    expect(slots.map((slot) => slot.date)).toEqual(['2027-01-31', '2027-02-07']);
    expect([...lastMonthlySlots(slots)]).toEqual([
      ['2027-01', 0],
      ['2027-02', 1],
    ]);
  });
});

describe('curriculum session preview', () => {
  it('keeps lesson order when one month is generated in separate ranges', async () => {
    const lessons = [
      { id: 'lesson-1', title: 'Bài 1', kind: 'LESSON', sequence: 1, status: 'APPROVED' },
      { id: 'lesson-2', title: 'Bài 2', kind: 'LESSON', sequence: 2, status: 'APPROVED' },
      {
        id: 'lesson-3',
        title: 'Bài 3',
        kind: 'LESSON',
        sequence: 3,
        status: 'APPROVED',
      },
      {
        id: 'legacy-test',
        title: 'Kiểm tra cũ',
        kind: 'MONTHLY_TEST',
        sequence: 1,
        monthKey: '2027-01',
        status: 'APPROVED',
      },
    ];
    const unit = {
      id: 'unit-1',
      programId: 'program-1',
      status: 'APPROVED',
      fromDate: new Date('2027-01-04T00:00:00Z'),
      toDate: new Date('2027-01-10T00:00:00Z'),
      track: { grade: 8, subjectKey: 'toan' },
      lessons,
    };
    const classroom = {
      id: 'class-1',
      programId: 'program-1',
      teacherId: 'teacher-1',
      teacher: { role: 'TEACHER', status: 'ACTIVE' },
      program: { grade: 8, subject: 'Toán', isActive: true },
      weeklySchedules: [1, 3, 5].map((weekday) => ({
        weekday,
        startTime: '18:00',
        endTime: '20:00',
      })),
    };
    const db = {
      curriculumUnit: { findUnique: jest.fn().mockResolvedValue(unit) },
      class: { findUnique: jest.fn().mockResolvedValue(classroom) },
      classSession: { findMany: jest.fn().mockResolvedValue([]) },
      schedulePreview: {
        create: jest.fn().mockResolvedValue({ id: 'preview-1', expiresAt: new Date('2027-01-04') }),
      },
    } as unknown as DatabaseService;
    const user = { id: 'manager-1', role: 'MANAGER' } as AuthenticatedUser;
    const service = new CurriculumSchedulingService(db, {} as NotificationEventsService);
    const first = (await service.preview(user, classroom.id, {
      curriculumUnitId: unit.id,
      fromDate: '2027-01-04',
      toDate: '2027-01-06',
    })) as { slots: Array<{ lessonId: string }> };
    const second = (await service.preview(user, classroom.id, {
      curriculumUnitId: unit.id,
      fromDate: '2027-01-07',
      toDate: '2027-01-10',
    })) as { slots: Array<{ lessonId: string; kind: string }> };
    expect(first.slots.map((slot) => slot.lessonId)).toEqual(['lesson-1', 'lesson-2']);
    expect(second.slots.map((slot) => slot.lessonId)).toEqual(['lesson-3']);
    expect(second.slots[0].kind).toBe('LESSON');
  });
});
