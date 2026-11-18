import { Prisma } from '@prisma/client';

// Mùng 1 Tết comes from the same table as the Tết break of schedule generation.
import { LUNAR_NEW_YEAR } from '../../common/lunar-new-year';

/** Share of the monthly fee taken off the package month that contains mùng 1 Tết. */
export const TET_DISCOUNT_PERCENT = 50;

/** Local calendar date (stored as UTC midnight) plus whole months, clamped to the month's last day. */
export function addCalendarMonths(startDate: Date, months: number): Date {
  const year = startDate.getUTCFullYear();
  const month = startDate.getUTCMonth();
  const day = startDate.getUTCDate();
  const targetFirst = new Date(Date.UTC(year, month + months, 1));
  const targetLastDay = new Date(
    Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0),
  ).getUTCDate();
  targetFirst.setUTCDate(Math.min(day, targetLastDay));
  return targetFirst;
}

export interface PackageMonth {
  /** First day of the package month (inclusive). */
  from: Date;
  /** Day after the package month (exclusive), i.e. the next month's `from`. */
  to: Date;
  price: Prisma.Decimal;
  tet: boolean;
}

export interface TuitionPrice {
  listAmount: Prisma.Decimal;
  tetDiscountAmount: Prisma.Decimal | null;
  tetPeriodStart: Date | null;
  tetPeriodEnd: Date | null;
  quotedAmount: Prisma.Decimal;
}

function tetDiscount(monthlyFee: Prisma.Decimal): Prisma.Decimal {
  return monthlyFee
    .mul(TET_DISCOUNT_PERCENT)
    .div(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
}

/** Months of a package from its start date; the month holding mùng 1 Tết is priced at half. */
export function packageMonths(
  startDate: Date,
  months: number,
  monthlyFee: Prisma.Decimal,
): PackageMonth[] {
  const fee = new Prisma.Decimal(monthlyFee);
  const tetDays = LUNAR_NEW_YEAR.map((day) => new Date(`${day}T00:00:00.000Z`));
  return Array.from({ length: months }, (_, index) => {
    const from = addCalendarMonths(startDate, index);
    const to = addCalendarMonths(startDate, index + 1);
    const tet = tetDays.some((day) => day >= from && day < to);
    return { from, to, tet, price: tet ? fee.sub(tetDiscount(fee)) : fee };
  });
}

/** Price of a new bill: monthly fee x months, with the Tết month at half (at most one per bill). */
export function priceTuition(
  monthlyFee: Prisma.Decimal,
  startDate: Date,
  months: number,
): TuitionPrice {
  const fee = new Prisma.Decimal(monthlyFee);
  const listAmount = fee.mul(months);
  const parts = packageMonths(startDate, months, fee);
  const tetMonths = parts.filter((part) => part.tet);
  const quotedAmount = parts.reduce((sum, part) => sum.add(part.price), new Prisma.Decimal(0));
  const first = tetMonths[0];
  return {
    listAmount,
    tetDiscountAmount: tetMonths.length ? listAmount.sub(quotedAmount) : null,
    tetPeriodStart: first?.from ?? null,
    tetPeriodEnd: first ? tetMonths[tetMonths.length - 1].to : null,
    quotedAmount,
  };
}

/** Bill fields for the Tết discount; bills created before it show none. */
export function tetPricing(order: {
  listAmount: Prisma.Decimal | null;
  tetDiscountAmount: Prisma.Decimal | null;
  tetPeriodStart: Date | null;
  tetPeriodEnd: Date | null;
  quotedAmount: Prisma.Decimal;
}): {
  listTotal: string;
  tetDiscount: { amount: string; fromDate: string; toDate: string } | null;
} {
  return {
    listTotal: (order.listAmount ?? order.quotedAmount).toFixed(2),
    tetDiscount:
      order.tetDiscountAmount && order.tetPeriodStart && order.tetPeriodEnd
        ? {
            amount: order.tetDiscountAmount.toFixed(2),
            fromDate: order.tetPeriodStart.toISOString().slice(0, 10),
            // Shown inclusive: the last day of the Tết package month.
            toDate: new Date(order.tetPeriodEnd.getTime() - 86_400_000).toISOString().slice(0, 10),
          }
        : null,
  };
}

export interface RefundQuote {
  paidAmount: string;
  months: { fromDate: string; toDate: string; price: string; tet: boolean; started: boolean }[];
  /** Months that start after `asOf`; the month in progress is not refunded. */
  notStartedAmount: string;
  refundedAmount: string;
  pendingAmount: string;
  /** What staff may still request: not-started months minus refunds already approved or pending. */
  refundable: string;
}

/** Refund proposal for a paid bill: every package month that has not started yet. */
export function quoteRefund(
  order: {
    startDate: Date | null;
    packageMonths: number;
    quotedAmount: Prisma.Decimal;
    listAmount: Prisma.Decimal | null;
  },
  paidAmount: Prisma.Decimal,
  asOf: Date,
  refunds: { status: string; amount: Prisma.Decimal }[],
): RefundQuote {
  const fee = (order.listAmount ?? order.quotedAmount).div(order.packageMonths);
  const parts = order.startDate ? packageMonths(order.startDate, order.packageMonths, fee) : [];
  // Legacy bills were never discounted for Tết: price every month at the fee.
  const priced = order.listAmount
    ? parts
    : parts.map((part) => ({ ...part, price: fee, tet: false }));
  const notStarted = priced
    .filter((part) => part.from > asOf)
    .reduce((sum, part) => sum.add(part.price), new Prisma.Decimal(0));
  const total = (status: string): Prisma.Decimal =>
    refunds
      .filter((refund) => refund.status === status)
      .reduce((sum, refund) => sum.add(refund.amount), new Prisma.Decimal(0));
  const refunded = total('APPROVED');
  const pending = total('PENDING');
  const capped = Prisma.Decimal.min(notStarted, paidAmount).sub(refunded).sub(pending);
  return {
    paidAmount: paidAmount.toFixed(2),
    months: priced.map((part) => ({
      fromDate: part.from.toISOString().slice(0, 10),
      toDate: new Date(part.to.getTime() - 86_400_000).toISOString().slice(0, 10),
      price: part.price.toFixed(2),
      tet: part.tet,
      started: part.from <= asOf,
    })),
    notStartedAmount: notStarted.toFixed(2),
    refundedAmount: refunded.toFixed(2),
    pendingAmount: pending.toFixed(2),
    refundable: Prisma.Decimal.max(capped, 0).toFixed(2),
  };
}
