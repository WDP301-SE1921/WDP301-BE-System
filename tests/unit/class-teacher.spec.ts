import { assignedTeacherAt } from '../../src/modules/registration-flow/class-teacher';

describe('effective teacher assignment', () => {
  const switchAt = new Date('2026-11-01T00:00:00.000Z');
  const classroom = {
    teacherId: 'teacher-one',
    pendingTeacherId: 'teacher-two',
    pendingTeacherFrom: switchAt,
  };

  it('keeps the current teacher until the exact effective instant', () => {
    expect(assignedTeacherAt(classroom, new Date(switchAt.getTime() - 1))).toBe('teacher-one');
    expect(assignedTeacherAt(classroom, switchAt)).toBe('teacher-two');
  });
});
