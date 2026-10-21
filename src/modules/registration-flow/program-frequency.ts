import { HttpStatus } from '@nestjs/common';

import { AppError } from '../../common/errors/app.error';

/** A weekly slot is one session, including separate slots on the same weekday. */
export function assertProgramFrequency(
  program: { id: string; sessionsPerWeek: number | null },
  actualCount: number,
  classId?: string,
  allowEmpty = false,
): void {
  // Closed classes may be created or cleared before their timetable is configured.
  if (allowEmpty && actualCount === 0) return;
  if (program.sessionsPerWeek === null) {
    throw new AppError(
      'PROGRAM_FREQUENCY_NOT_CONFIGURED',
      'Configure the program sessions per week before using this timetable',
      HttpStatus.CONFLICT,
      { programId: program.id },
    );
  }
  if (actualCount !== program.sessionsPerWeek) {
    throw new AppError(
      'CLASS_WEEKLY_SESSION_COUNT_MISMATCH',
      'Weekly slots must match the program sessions per week',
      HttpStatus.CONFLICT,
      {
        programId: program.id,
        ...(classId === undefined ? {} : { classId }),
        expected: program.sessionsPerWeek,
        actual: actualCount,
      },
    );
  }
}
