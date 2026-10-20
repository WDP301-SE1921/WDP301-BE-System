import { type ValidationError, validateSync } from 'class-validator';

import {
  ProgramDto,
  UpdateProgramDto,
} from '../../src/modules/registration-flow/dto/registration-flow.dto';
import { assertProgramFrequency } from '../../src/modules/registration-flow/program-frequency';

function thrown(work: () => void): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('program weekly frequency', () => {
  const program = { id: 'program', sessionsPerWeek: 2 };

  it('accepts exactly the number of weekly slots configured for the course', () => {
    expect(() => assertProgramFrequency(program, 2, 'class')).not.toThrow();
    for (const actual of [0, 1, 3]) {
      expect(thrown(() => assertProgramFrequency(program, actual, 'class'))).toMatchObject({
        code: 'CLASS_WEEKLY_SESSION_COUNT_MISMATCH',
        statusCode: 409,
        details: { programId: 'program', classId: 'class', expected: 2, actual },
      });
    }
  });

  it('requires configuration before using a nonempty timetable', () => {
    expect(
      thrown(() => assertProgramFrequency({ ...program, sessionsPerWeek: null }, 2, 'class')),
    ).toMatchObject({
      code: 'PROGRAM_FREQUENCY_NOT_CONFIGURED',
      statusCode: 409,
      details: { programId: 'program' },
    });
  });

  it('allows only a completely empty closed timetable during configuration', () => {
    expect(() => assertProgramFrequency(program, 0, 'class', true)).not.toThrow();
    expect(() =>
      assertProgramFrequency({ ...program, sessionsPerWeek: null }, 0, 'class', true),
    ).not.toThrow();
    expect(() => assertProgramFrequency(program, 1, 'class', true)).toThrow();
    expect(() =>
      assertProgramFrequency({ ...program, sessionsPerWeek: null }, 1, 'class', true),
    ).toThrow();
  });
});

describe('program frequency DTO transition', () => {
  for (const Dto of [ProgramDto, UpdateProgramDto]) {
    const errors = (sessionsPerWeek: unknown, include = true): ValidationError[] =>
      validateSync(
        Object.assign(new Dto(), {
          name: 'Toán 8',
          subject: 'Toán',
          grade: 8,
          ...(include ? { sessionsPerWeek } : {}),
        }),
      ).filter((error) => error.property === 'sessionsPerWeek');

    it(`${Dto.name} accepts omission during migration and integer boundary values`, () => {
      expect(errors(undefined, false)).toHaveLength(0);
      for (const value of [1, 2, 14]) expect(errors(value)).toHaveLength(0);
    });

    it(`${Dto.name} rejects explicit null and values outside the integer contract`, () => {
      for (const value of [null, 0, -1, 1.5, 15, '2', true]) {
        expect(errors(value)).not.toHaveLength(0);
      }
    });
  }
});
