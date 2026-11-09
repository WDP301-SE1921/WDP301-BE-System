import { EnrollmentWorkflowsService } from '../../src/modules/academic/enrollment-workflows.service';

interface Call {
  model: string;
  method: string;
  args: unknown;
}
type Handler = (args: unknown) => unknown;

/** Prisma transaction giả: mọi model trả giá trị trống hợp lệ, ghi lại các lần gọi. */
function fakeTx(calls: Call[]): unknown {
  const results: Record<string, Handler> = {
    findUniqueOrThrow: () => ({ id: 'enr-1', registrationOrderId: 'order-1', status: 'ACTIVE' }),
    findUnique: () => null,
    findMany: (args) =>
      (args as { where?: { studentProfileId?: string } } | undefined)?.where?.studentProfileId
        ? [{ id: 'enr-1' }]
        : [],
    updateMany: () => ({ count: 0 }),
    update: (args) => ({ id: 'x', ...(args as { data: object }).data }),
    create: (args) => (args as { data: object }).data,
    count: () => 0,
  };
  const model = (name: string): unknown =>
    new Proxy(
      {},
      {
        get:
          (_target, method: string): Handler =>
          (args: unknown): Promise<unknown> => {
            calls.push({ model: name, method, args });
            return Promise.resolve(results[method]?.(args) ?? null);
          },
      },
    );
  return new Proxy({}, { get: (_target, name: string): unknown => model(name) });
}

function service(calls: Call[]): EnrollmentWorkflowsService {
  const tx = fakeTx(calls);
  const repo = { transaction: (fn: (t: unknown) => unknown): unknown => fn(tx) };
  const notifications = { workflow: (): Promise<void> => Promise.resolve() };
  return new EnrollmentWorkflowsService(repo as never, {} as never, notifications as never);
}

const staff = { id: 'staff-1', role: 'STAFF' } as never;
function auditData(calls: Call[]): { action: string; afterData: Record<string, unknown> } {
  const call = calls.find((c) => c.model === 'auditLog' && c.method === 'create');
  return (call?.args as { data: { action: string; afterData: Record<string, unknown> } }).data;
}

describe('reason when ending study', () => {
  it('records the chosen reason when one enrollment ends', async () => {
    const calls: Call[] = [];
    await service(calls).endEnrollment(staff, 'enr-1', { reason: 'Chuyển trường, chuyển nơi ở' });
    const data = auditData(calls);
    expect(data.action).toBe('ENROLLMENT_END');
    expect(data.afterData.reason).toBe('Chuyển trường, chuyển nơi ở');
  });

  it('keeps the old audit shape when no reason is sent', async () => {
    const calls: Call[] = [];
    await service(calls).endEnrollment(staff, 'enr-1');
    expect(auditData(calls).afterData).not.toHaveProperty('reason');
  });

  it('records the chosen reason when the student stops studying', async () => {
    const calls: Call[] = [];
    await service(calls).endStudent(staff, 'student-1', { reason: 'Khó khăn tài chính' });
    const data = auditData(calls);
    expect(data.action).toBe('STUDENT_END_STUDY');
    expect(data.afterData.reason).toBe('Khó khăn tài chính');
    expect(data.afterData.enrollmentIds).toEqual(['enr-1']);
  });
});
