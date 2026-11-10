import { scheduledUntilByClass } from '../../src/modules/registration-flow/class-scheduled-until';
import { RegistrationFlowService } from '../../src/modules/registration-flow/registration-flow.service';

const manager = { id: 'manager-1', role: 'MANAGER' } as never;

describe('scheduledUntil', () => {
  it('reports the Vietnam date of the last non-cancelled session per class', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      // 18:00 on 2026-12-31 in Vietnam is 11:00 UTC the same day.
      { classId: 'class-a', _max: { startsAt: new Date('2026-12-31T11:00:00.000Z') } },
      // 06:00 on 2027-01-01 in Vietnam is still 2026-12-31 in UTC.
      { classId: 'class-b', _max: { startsAt: new Date('2026-12-31T23:00:00.000Z') } },
      { classId: 'class-c', _max: { startsAt: null } },
    ]);
    const result = await scheduledUntilByClass({ classSession: { groupBy } } as never, [
      'class-a',
      'class-b',
      'class-c',
      'class-a',
    ]);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['classId'],
      where: { classId: { in: ['class-a', 'class-b', 'class-c'] }, status: { not: 'CANCELLED' } },
      _max: { startsAt: true },
    });
    expect(result.get('class-a')).toBe('2026-12-31');
    expect(result.get('class-b')).toBe('2027-01-01');
    expect(result.has('class-c')).toBe(false);
  });

  it('does not query when there are no classes', async () => {
    const groupBy = jest.fn();
    expect((await scheduledUntilByClass({ classSession: { groupBy } } as never, [])).size).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('adds scheduledUntil to every class of a program detail', async () => {
    const db = {
      program: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'program-1',
          curriculumUnits: [],
          classes: [
            { id: 'class-a', name: 'Toán 8A' },
            { id: 'class-b', name: 'Toán 8B' },
          ],
        }),
      },
      classSession: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { classId: 'class-a', _max: { startsAt: new Date('2027-01-20T11:00:00.000Z') } },
          ]),
      },
    };
    const service = new RegistrationFlowService(db as never, {} as never);
    const result = (await service.getProgram(manager, 'program-1')) as {
      classes: Array<{ id: string; scheduledUntil: string | null }>;
    };
    expect(result.classes.map((row) => [row.id, row.scheduledUntil])).toEqual([
      ['class-a', '2027-01-20'],
      ['class-b', null],
    ]);
  });
});
