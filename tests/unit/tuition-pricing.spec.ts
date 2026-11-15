import { Prisma } from '@prisma/client';

import {
  packageMonths,
  priceTuition,
  quoteRefund,
  tetPricing,
} from '../../src/modules/registration-flow/tuition-pricing';

const day = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const fee = new Prisma.Decimal(800000);

describe('Tết half-month price', () => {
  it('halves the package month that contains mùng 1 Tết', () => {
    // Mùng 1 Tết 2027 is 06/02/2027, inside 15/01-15/02.
    const price = priceTuition(fee, day('2027-01-15'), 3);
    expect(price.listAmount.toString()).toBe('2400000');
    expect(price.tetDiscountAmount?.toString()).toBe('400000');
    expect(price.quotedAmount.toString()).toBe('2000000');
    expect(price.tetPeriodStart?.toISOString().slice(0, 10)).toBe('2027-01-15');
    expect(price.tetPeriodEnd?.toISOString().slice(0, 10)).toBe('2027-02-15');
  });

  it('keeps the full price when the package has no Tết', () => {
    const price = priceTuition(fee, day('2026-09-01'), 3);
    expect(price.quotedAmount.toString()).toBe('2400000');
    expect(price.tetDiscountAmount).toBeNull();
    expect(price.tetPeriodStart).toBeNull();
  });

  it('counts mùng 1 on the first day of a month and not on the day after it', () => {
    expect(priceTuition(fee, day('2027-02-06'), 1).tetDiscountAmount?.toString()).toBe('400000');
    expect(priceTuition(fee, day('2027-01-06'), 1).tetDiscountAmount).toBeNull();
  });

  it('rounds the discount down to whole đồng', () => {
    const odd = priceTuition(new Prisma.Decimal(850001), day('2027-02-01'), 1);
    expect(odd.tetDiscountAmount?.toString()).toBe('425000');
    expect(odd.quotedAmount.toString()).toBe('425001');
  });

  it('shows the Tết month inclusively on the bill', () => {
    const price = priceTuition(fee, day('2027-01-15'), 3);
    expect(tetPricing(price).tetDiscount).toEqual({
      amount: '400000.00',
      fromDate: '2027-01-15',
      toDate: '2027-02-14',
    });
  });

  it('gives a legacy bill its total as list total and no Tết line', () => {
    const legacy = {
      listAmount: null,
      tetDiscountAmount: null,
      tetPeriodStart: null,
      tetPeriodEnd: null,
      quotedAmount: new Prisma.Decimal(2400000),
    };
    expect(tetPricing(legacy)).toEqual({ listTotal: '2400000.00', tetDiscount: null });
  });

  it('splits a package into calendar months from the start date', () => {
    const months = packageMonths(day('2027-01-31'), 2, fee);
    expect(months.map((m) => m.from.toISOString().slice(0, 10))).toEqual([
      '2027-01-31',
      '2027-02-28',
    ]);
  });
});

describe('refund of months not started', () => {
  const order = {
    startDate: day('2027-01-15'),
    packageMonths: 3,
    quotedAmount: new Prisma.Decimal(2000000),
    listAmount: new Prisma.Decimal(2400000),
  };
  const paid = new Prisma.Decimal(2000000);

  it('refunds only months that start after today, at their real price', () => {
    // 20/02: month 2 (15/02-15/03) is in progress, month 3 (15/03-15/04) has not started.
    const quote = quoteRefund(order, paid, day('2027-02-20'), []);
    expect(quote.notStartedAmount).toBe('800000.00');
    expect(quote.refundable).toBe('800000.00');
    expect(quote.months.map((m) => m.started)).toEqual([true, true, false]);
  });

  it('refunds the half-price Tết month at half', () => {
    const quote = quoteRefund(order, paid, day('2027-01-10'), []);
    expect(quote.notStartedAmount).toBe('2000000.00');
    expect(quote.months[0]).toMatchObject({ tet: true, price: '400000.00' });
  });

  it('does not refund the month that starts today', () => {
    expect(quoteRefund(order, paid, day('2027-03-15'), []).refundable).toBe('0.00');
  });

  it('subtracts refunds already approved or pending', () => {
    const refunds = [
      { status: 'APPROVED', amount: new Prisma.Decimal(300000) },
      { status: 'PENDING', amount: new Prisma.Decimal(200000) },
      { status: 'REJECTED', amount: new Prisma.Decimal(999999) },
    ];
    const quote = quoteRefund(order, paid, day('2027-02-20'), refunds);
    expect(quote.refundedAmount).toBe('300000.00');
    expect(quote.pendingAmount).toBe('200000.00');
    expect(quote.refundable).toBe('300000.00');
  });

  it('prices every month at the fee for a bill made before the Tết rule', () => {
    const legacy = { ...order, listAmount: null, quotedAmount: new Prisma.Decimal(2400000) };
    const quote = quoteRefund(legacy, new Prisma.Decimal(2400000), day('2027-01-10'), []);
    expect(quote.notStartedAmount).toBe('2400000.00');
    expect(quote.months.every((m) => !m.tet)).toBe(true);
  });
});
