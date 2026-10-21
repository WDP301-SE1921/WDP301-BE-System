import { attendanceContribution } from '../../src/modules/academic/attendance-calculation';

describe('shared attendance calculation', () => {
  it.each([
    ['PRESENT', false, 'PRESENT', 1, 1],
    ['ABSENT', false, 'ABSENT', 1, 0],
    ['UNMARKED', false, 'ABSENT', 1, 0],
    ['ABSENT', true, 'MADE_UP', 1, 1],
    ['UNMARKED', true, 'MADE_UP', 1, 1],
    ['EXCUSED', false, 'EXCUSED', 0, 0],
  ] as const)(
    '%s with makeup=%s contributes %s',
    (status, madeUp, effectiveStatus, required, attended) => {
      expect(attendanceContribution(status, madeUp)).toEqual({
        effectiveStatus,
        required,
        attended,
      });
    },
  );
});
