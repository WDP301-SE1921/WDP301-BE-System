import { Prisma } from '@prisma/client';

import { PaymentRefundsService } from '../../src/modules/registration-flow/payment-refunds.service';

const staff = { id: 'staff-1', role: 'STAFF' } as never;
const manager = { id: 'manager-1', role: 'MANAGER' } as never;
const D = (value: number | string): Prisma.Decimal => new Prisma.Decimal(value);

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function paymentDb(refunds: { status: string; amount: Prisma.Decimal }[] = []) {
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    payment: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'pay-1',
        amount: D(2000000),
        refunds,
        registrationOrder: { enrollment: { id: 'enr-1' } },
      }),
    },
    paymentRefund: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'ref-1', status: 'PENDING', createdAt: new Date(), decidedAt: null, ...data }),
      ),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: (work: (tx: unknown) => unknown): unknown => work(db),
  };
  return db;
}

describe('refund requests', () => {
  const input = { amount: '800000', method: 'CASH' as const, reason: 'Nghỉ hẳn trước kỳ' };

  it('records a pending refund with its method and the enrollment', async () => {
    const db = paymentDb();
    const result = (await new PaymentRefundsService(db as never).request(staff, 'pay-1', input)) as {
      status: string;
      amount: string;
      method: string;
    };
    expect(result).toMatchObject({ status: 'PENDING', amount: '800000.00', method: 'CASH' });
    expect(db.paymentRefund.create.mock.calls[0][0].data).toMatchObject({ enrollmentId: 'enr-1' });
    expect(db.auditLog.create.mock.calls[0][0].data.action).toBe('PAYMENT_REFUND_REQUESTED');
  });

  it('rejects a second refund while one is pending', async () => {
    const db = paymentDb([{ status: 'PENDING', amount: D(100000) }]);
    expect(await codeOf(new PaymentRefundsService(db as never).request(staff, 'pay-1', input))).toBe(
      'REFUND_PENDING',
    );
  });

  it('rejects refunds whose total exceeds the paid amount', async () => {
    const db = paymentDb([{ status: 'APPROVED', amount: D(1500000) }]);
    const service = new PaymentRefundsService(db as never);
    expect(await codeOf(service.request(staff, 'pay-1', { ...input, amount: '500001' }))).toBe(
      'REFUND_TOO_LARGE',
    );
    await expect(service.request(staff, 'pay-1', { ...input, amount: '500000' })).resolves.toBeTruthy();
  });

  it('only lets staff record a refund', async () => {
    expect(await codeOf(new PaymentRefundsService(paymentDb() as never).request(manager, 'pay-1', input))).toBe(
      'FORBIDDEN',
    );
  });
});

describe('refund decisions', () => {
  function refundDb(status = 'PENDING') {
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentRefund: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ref-1',
          status,
          amount: D(800000),
          method: 'BANK_TRANSFER',
          reason: 'Nghỉ hẳn trước kỳ',
          payment: {
            receiptNumber: 'RCPT-1',
            currency: 'VND',
            registrationOrder: { parentEmail: 'ph@example.com', studentFullName: 'An' },
          },
        }),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'ref-1',
            amount: D(800000),
            method: 'BANK_TRANSFER',
            reason: 'Nghỉ hẳn trước kỳ',
            createdAt: new Date(),
            ...data,
          }),
        ),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
      $transaction: (work: (tx: unknown) => unknown): unknown => work(db),
    };
    return db;
  }

  it('approval emails the parent and is audited', async () => {
    const db = refundDb();
    const result = (await new PaymentRefundsService(db as never).decide(manager, 'ref-1', {
      approve: true,
    })) as { status: string };
    expect(result.status).toBe('APPROVED');
    expect(db.outboxEvent.create.mock.calls[0][0].data.payload.text).toContain('Chuyển khoản');
    expect(db.auditLog.create.mock.calls[0][0].data.action).toBe('PAYMENT_REFUND_APPROVED');
  });

  it('rejection sends no email', async () => {
    const db = refundDb();
    await new PaymentRefundsService(db as never).decide(manager, 'ref-1', {
      approve: false,
      note: 'Số tiền chưa đúng',
    });
    expect(db.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('cannot decide twice', async () => {
    const service = new PaymentRefundsService(refundDb('APPROVED') as never);
    expect(await codeOf(service.decide(manager, 'ref-1', { approve: true }))).toBe('REQUEST_DECIDED');
  });

  it('only managers decide', async () => {
    const service = new PaymentRefundsService(refundDb() as never);
    expect(await codeOf(service.decide(staff, 'ref-1', { approve: true }))).toBe('FORBIDDEN');
  });
});
