import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { roleAllowed } from '../../common/auth/role-access';
import { AppError } from '../../common/errors/app.error';
import { dateTimeRange } from '../../common/list-query';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { DatabaseService } from '../../database/orm/database.service';
import type { CreateRefundDto, DecideRefundDto, RefundListQueryDto } from './dto/registration-flow.dto';
import { PAYMENT_METHOD_LABELS, refundView } from './registration-flow.service';
import { moneyText } from './registration-text';
import { quoteRefund } from './tuition-pricing';

const HCM_OFFSET_MS = 7 * 3600_000;

function localDay(at: Date): Date {
  return new Date(`${new Date(at.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function assert(
  condition: unknown,
  code: string,
  message: string,
  status = HttpStatus.CONFLICT,
): asserts condition {
  if (!condition) throw new AppError(code, message, status);
}

function requireRoles(user: AuthenticatedUser, ...roles: AuthenticatedUser['role'][]): void {
  assert(roleAllowed(user.role, roles), 'FORBIDDEN', 'Role is not allowed', HttpStatus.FORBIDDEN);
}

/**
 * Refunds when a student quits: the system proposes the months that have not started, staff record
 * what they pay back (cash or transfer), a manager approves; only approved refunds lower revenue.
 */
@Injectable()
export class PaymentRefundsService {
  constructor(private readonly db: DatabaseService) {}

  /** Proposal for the bill behind an enrollment, as of the day it ended (or today). */
  async quote(user: AuthenticatedUser, enrollmentId: string): Promise<unknown> {
    requireRoles(user, 'STAFF', 'MANAGER');
    const enrollment = await this.db.enrollment.findUnique({
      where: { id: enrollmentId },
      include: { registrationOrder: { include: { payment: { include: { refunds: true } } } } },
    });
    assert(enrollment, 'ENROLLMENT_NOT_FOUND', 'Enrollment not found', HttpStatus.NOT_FOUND);
    const payment = enrollment.registrationOrder.payment;
    assert(payment, 'PAYMENT_NOT_FOUND', 'This enrollment has no confirmed payment', HttpStatus.NOT_FOUND);
    const asOf = localDay(enrollment.endedAt ?? new Date());
    return {
      enrollmentId,
      enrollmentStatus: enrollment.status,
      paymentId: payment.id,
      receiptNumber: payment.receiptNumber,
      asOf: asOf.toISOString().slice(0, 10),
      ...quoteRefund(enrollment.registrationOrder, payment.amount, asOf, payment.refunds),
    };
  }

  async request(user: AuthenticatedUser, paymentId: string, input: CreateRefundDto): Promise<unknown> {
    requireRoles(user, 'STAFF');
    const amount = new Prisma.Decimal(input.amount);
    assert(amount.gt(0), 'REFUND_AMOUNT_REQUIRED', 'Refund amount must be positive', HttpStatus.BAD_REQUEST);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId} FOR UPDATE`;
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: { refunds: true, registrationOrder: { include: { enrollment: true } } },
      });
      assert(payment, 'PAYMENT_NOT_FOUND', 'Payment not found', HttpStatus.NOT_FOUND);
      assert(
        !payment.refunds.some((refund) => refund.status === 'PENDING'),
        'REFUND_PENDING',
        'This payment already has a refund waiting for a manager',
      );
      const approved = payment.refunds
        .filter((refund) => refund.status === 'APPROVED')
        .reduce((sum, refund) => sum.add(refund.amount), new Prisma.Decimal(0));
      assert(
        amount.lte(payment.amount.sub(approved)),
        'REFUND_TOO_LARGE',
        'Refunds cannot exceed the paid amount',
      );
      const refund = await tx.paymentRefund.create({
        data: {
          paymentId,
          enrollmentId: payment.registrationOrder.enrollment?.id ?? null,
          amount,
          method: input.method,
          reason: input.reason.trim(),
          requestedById: user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'PAYMENT_REFUND_REQUESTED',
          entityType: 'PaymentRefund',
          entityId: refund.id,
          afterData: { paymentId, amount: amount.toFixed(2), method: input.method, reason: refund.reason },
        },
      });
      return refundView(refund);
    }, { isolationLevel: 'RepeatableRead' });
  }

  async list(user: AuthenticatedUser, query: RefundListQueryDto): Promise<unknown> {
    requireRoles(user, 'STAFF', 'MANAGER');
    const where: Prisma.PaymentRefundWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.fromDate || query.toDate ? { createdAt: dateTimeRange(query.fromDate, query.toDate) } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.paymentRefund.findMany({
        where,
        include: {
          payment: {
            select: {
              id: true,
              receiptNumber: true,
              amount: true,
              method: true,
              confirmedAt: true,
              registrationOrder: {
                select: {
                  id: true,
                  studentFullName: true,
                  parentEmail: true,
                  class: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.paymentRefund.count({ where }),
    ]);
    const userIds = [...new Set(rows.flatMap((row) => [row.requestedById, row.decidedById ?? '']))].filter(Boolean);
    const users = await this.db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, displayName: true, email: true },
    });
    const person = (id: string | null): { id: string; displayName: string | null } | null => {
      const found = users.find((item) => item.id === id);
      return found ? { id: found.id, displayName: found.displayName ?? found.email } : null;
    };
    return {
      items: rows.map((row) => ({
        ...refundView(row),
        decisionNote: row.decisionNote,
        payment: {
          id: row.payment.id,
          receiptNumber: row.payment.receiptNumber,
          amount: row.payment.amount.toFixed(2),
          method: row.payment.method,
          confirmedAt: row.payment.confirmedAt.toISOString(),
          registrationId: row.payment.registrationOrder.id,
          studentFullName: row.payment.registrationOrder.studentFullName,
          parentEmail: row.payment.registrationOrder.parentEmail,
          className: row.payment.registrationOrder.class.name,
        },
        requestedBy: person(row.requestedById),
        decidedBy: person(row.decidedById),
      })),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async decide(user: AuthenticatedUser, id: string, input: DecideRefundDto): Promise<unknown> {
    requireRoles(user, 'MANAGER');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payment_refunds WHERE id = ${id} FOR UPDATE`;
      const refund = await tx.paymentRefund.findUnique({
        where: { id },
        include: { payment: { include: { registrationOrder: true } } },
      });
      assert(refund, 'REFUND_NOT_FOUND', 'Refund not found', HttpStatus.NOT_FOUND);
      assert(refund.status === 'PENDING', 'REQUEST_DECIDED', 'Refund has already been decided');
      const updated = await tx.paymentRefund.update({
        where: { id },
        data: {
          status: input.approve ? 'APPROVED' : 'REJECTED',
          decidedById: user.id,
          decidedAt: new Date(),
          decisionNote: input.note?.trim() || null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: input.approve ? 'PAYMENT_REFUND_APPROVED' : 'PAYMENT_REFUND_REJECTED',
          entityType: 'PaymentRefund',
          entityId: id,
          afterData: { amount: refund.amount.toFixed(2), note: updated.decisionNote },
        },
      });
      if (input.approve) {
        const order = refund.payment.registrationOrder;
        await tx.outboxEvent.create({
          data: {
            eventType: 'PAYMENT_REFUNDED',
            aggregateType: 'PaymentRefund',
            aggregateId: id,
            recipient: order.parentEmail,
            subject: `EduGrade - Hoàn học phí cho ${order.studentFullName}`,
            dedupeKey: `PAYMENT_REFUNDED:${id}`,
            payload: {
              text: `Trung tâm đã hoàn ${moneyText(refund.amount, refund.payment.currency)} (${PAYMENT_METHOD_LABELS[refund.method]}) cho phiếu thu ${refund.payment.receiptNumber} của ${order.studentFullName}. Lý do: ${refund.reason}.`,
            },
          },
        });
      }
      return refundView(updated);
    }, { isolationLevel: 'RepeatableRead' });
  }
}
