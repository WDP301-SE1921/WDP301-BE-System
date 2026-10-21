import type { AttendanceStatus } from '@prisma/client';

export function attendanceContribution(
  attendance: AttendanceStatus,
  madeUp: boolean,
): {
  effectiveStatus: 'PRESENT' | 'ABSENT' | 'MADE_UP' | 'EXCUSED';
  required: number;
  attended: number;
} {
  if (attendance === 'EXCUSED') return { effectiveStatus: 'EXCUSED', required: 0, attended: 0 };
  if (attendance === 'PRESENT') return { effectiveStatus: 'PRESENT', required: 1, attended: 1 };
  if (madeUp) return { effectiveStatus: 'MADE_UP', required: 1, attended: 1 };
  return { effectiveStatus: 'ABSENT', required: 1, attended: 0 };
}
