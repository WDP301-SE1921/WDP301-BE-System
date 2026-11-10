import { EnrollmentWorkflowsService } from '../../src/modules/academic/enrollment-workflows.service';

const staff = { id: 'staff-1', role: 'STAFF' } as never;
const input = { originalParticipantId: 'seat-1', targetSessionId: 'target-1' } as never;

type LockSetup = {
  service: EnrollmentWorkflowsService;
  tx: { $queryRaw: jest.Mock };
  order: string[];
};

function setup(lessons: string[]): LockSetup {
  const order: string[] = [];
  const tx = {
    sessionParticipant: {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce({ sessionId: 'source-1' })
        // The step after the guard: reaching it means the guard let the booking through.
        .mockRejectedValueOnce(new Error('next step')),
    },
    $queryRaw: jest.fn(() => {
      order.push('lock');
      return Promise.resolve(
        lessons.map((lessonId, index) => ({ id: index ? 'target-1' : 'source-1', lessonId })),
      );
    }),
  };
  const repo = { transaction: jest.fn((work: (value: unknown) => unknown) => work(tx)) };
  const service = new EnrollmentWorkflowsService(repo as never, {} as never, {} as never);
  jest
    .spyOn(service as unknown as { makeupTargetState: () => Promise<unknown> }, 'makeupTargetState')
    .mockImplementation(() => {
      order.push('check');
      return Promise.resolve({ source: {}, target: {}, availableSeats: 1, reasonCodes: [] });
    });
  return { service, tx, order };
}

describe('makeup booking locks both sessions', () => {
  it('locks the source and target sessions before checking the makeup', async () => {
    const { service, tx, order } = setup(['L1', 'L1']);
    await expect(service.bookMakeup(staff, input)).rejects.toThrow('next step');
    expect(order).toEqual(['lock', 'check']);
    const sql = (tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join('?');
    expect(sql).toContain('FOR UPDATE');
  });

  it('refuses a target whose locked lesson no longer matches the source lesson', async () => {
    const { service } = setup(['L1', 'L2']);
    await expect(service.bookMakeup(staff, input)).rejects.toMatchObject({
      code: 'INVALID_MAKEUP_TARGET',
    });
  });
});
