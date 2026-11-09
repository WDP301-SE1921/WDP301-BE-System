import { RegistrationFlowService } from '../../src/modules/registration-flow/registration-flow.service';

const manager = { id: 'manager-1', role: 'MANAGER' } as never;

function serviceWith(users: unknown[]): RegistrationFlowService {
  const db = {
    classSession: {
      findUnique: (): Promise<unknown> =>
        Promise.resolve({
          id: 'session-1',
          teacherId: 'teacher-current',
          startsAt: new Date('2026-11-16T09:00:00.000Z'),
          endsAt: new Date('2026-11-16T11:00:00.000Z'),
        }),
    },
    user: {
      findMany: (): Promise<unknown[]> => Promise.resolve(users),
      count: (): Promise<number> => Promise.resolve(users.length),
    },
  };
  return new RegistrationFlowService(db as never, {} as never);
}

describe('substitute candidates', () => {
  it('lists the subjects each free teacher already teaches, once each', async () => {
    const result = (await serviceWith([
      {
        id: 'teacher-a',
        email: 'a@edugrade.local',
        displayName: 'Đỗ Duy Kiên',
        teachingClasses: [
          { program: { subject: 'Sinh học' } },
          { program: { subject: 'Sinh học' } },
          { program: { subject: 'Hóa học' } },
        ],
      },
      { id: 'teacher-b', email: 'b@edugrade.local', displayName: 'Mới vào', teachingClasses: [] },
    ]).substituteCandidates(manager, 'session-1')) as Array<Record<string, unknown>>;

    expect(result).toEqual([
      {
        id: 'teacher-a',
        email: 'a@edugrade.local',
        displayName: 'Đỗ Duy Kiên',
        subjects: ['Sinh học', 'Hóa học'],
      },
      { id: 'teacher-b', email: 'b@edugrade.local', displayName: 'Mới vào', subjects: [] },
    ]);
  });
});
