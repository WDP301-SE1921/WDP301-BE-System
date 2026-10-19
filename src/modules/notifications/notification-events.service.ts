import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NotificationTargetKind, Prisma } from '@prisma/client';
import { NotificationRecipientsService } from './notification-recipients.service';
import { NotificationsService, type NotificationRecipient } from './notifications.service';
import type { NotificationType } from './notifications.dto';

@Injectable()
export class NotificationEventsService {
  constructor(
    private readonly notifications: NotificationsService,
    readonly recipients: NotificationRecipientsService,
  ) {}
  async send(
    tx: Prisma.TransactionClient,
    actorId: string,
    type: NotificationType,
    targetKind: NotificationTargetKind,
    targetId: string,
    title: string,
    body: string,
    recipients: NotificationRecipient[],
    classId?: string,
    eventKey: string = randomUUID(),
  ): Promise<void> {
    await this.notifications.record(tx, {
      actorId,
      type,
      targetKind,
      targetId,
      title,
      body,
      recipients,
      classId,
      eventKey,
    });
  }
  async family(
    tx: Prisma.TransactionClient,
    actorId: string,
    enrollmentId: string,
    type: NotificationType,
    targetKind: NotificationTargetKind,
    targetId: string,
    body: string,
    eventKey?: string,
    parentsOnly = false,
  ): Promise<void> {
    const scope = await this.recipients.family(tx, enrollmentId, !parentsOnly);
    const classId =
      targetKind === 'ASSIGNMENT'
        ? (
            await tx.assignment.findUniqueOrThrow({
              where: { id: targetId },
              select: { classId: true },
            })
          ).classId
        : scope.classId;
    await this.send(
      tx,
      actorId,
      type,
      targetKind,
      targetId,
      'Cập nhật học tập',
      body,
      scope.recipients,
      classId,
      eventKey,
    );
  }
  async session(
    tx: Prisma.TransactionClient,
    actorId: string,
    sessionId: string,
    type: NotificationType,
    body: string,
    key: string,
    previous?: { id: string; classId: string; startsAt: Date; teacherId: string },
  ): Promise<void> {
    const session = await tx.classSession.findUniqueOrThrow({ where: { id: sessionId } });
    await this.send(
      tx,
      actorId,
      type,
      'SESSION',
      sessionId,
      'Cập nhật lịch học',
      body,
      await this.recipients.sessions(tx, previous ? [previous, session] : [session]),
      session.classId,
      key,
    );
  }
  async assignment(
    tx: Prisma.TransactionClient,
    actorId: string,
    id: string,
    type: NotificationType,
    body: string,
    key: string,
  ): Promise<void> {
    const assignment = await tx.assignment.findUniqueOrThrow({
      where: { id },
      select: { title: true, classId: true, recipients: { select: { enrollmentId: true } } },
    });
    for (const recipient of assignment.recipients)
      await this.family(
        tx,
        actorId,
        recipient.enrollmentId,
        type,
        'ASSIGNMENT',
        id,
        `${assignment.title}: ${body}`,
        key,
        true,
      );
  }
  async curriculum(
    tx: Prisma.TransactionClient,
    actorId: string,
    id: string,
    type: NotificationType,
    body: string,
    key: string,
  ): Promise<void> {
    const unit = await tx.curriculumUnit.findUniqueOrThrow({
      where: { id },
      select: { designerId: true, title: true },
    });
    const recipients =
      type === 'CURRICULUM_SUBMITTED'
        ? await this.recipients.roles(tx, ['MANAGER'])
        : [{ userId: unit.designerId }];
    await this.send(
      tx,
      actorId,
      type,
      'CURRICULUM_UNIT',
      id,
      'Cập nhật giáo trình',
      `${unit.title}: ${body}`,
      recipients,
      undefined,
      key,
    );
  }
  async workflow(
    tx: Prisma.TransactionClient,
    actorId: string,
    enrollmentId: string,
    eventType: string,
    aggregateId: string,
    body: string,
    eventKey?: string,
  ): Promise<void> {
    const scope = await this.recipients.family(
      tx,
      enrollmentId,
      eventType !== 'ATTENDANCE_FINALIZED',
    );
    let recipients = scope.recipients;
    let type = eventType as NotificationType;
    let targetKind: NotificationTargetKind = 'ENROLLMENT';
    let targetId = enrollmentId;
    let classId = scope.classId;
    if (eventType.startsWith('LEAVE_')) {
      targetKind = 'LEAVE';
      targetId = aggregateId;
      const leave = await tx.leaveRequest.findUniqueOrThrow({ where: { id: aggregateId } });
      if (eventType === 'LEAVE_REQUESTED') recipients = await this.recipients.roles(tx, ['STAFF']);
      if (eventType === 'LEAVE_DECIDED')
        type = leave.status === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED';
      if (leave.sessionId && eventType !== 'LEAVE_REQUESTED') {
        const session = await tx.classSession.findUniqueOrThrow({ where: { id: leave.sessionId } });
        classId = session.classId;
        recipients.push({
          userId: session.teacherId,
          studentIds: scope.studentId ? [scope.studentId] : [],
        });
      }
    }
    if (eventType.startsWith('MAKEUP_')) {
      targetKind = 'MAKEUP';
      targetId = aggregateId;
      const booking = await tx.makeupBooking.findUniqueOrThrow({
        where: { id: aggregateId },
        include: { replacement: { include: { session: true } } },
      });
      classId = booking.replacement.session.classId;
      recipients = (await this.recipients.family(tx, enrollmentId, false)).recipients;
      recipients.push({
        userId: booking.replacement.session.teacherId,
        studentIds: scope.studentId ? [scope.studentId] : [],
      });
    }
    if (eventType === 'ATTENDANCE_FINALIZED') {
      targetKind = 'SESSION';
      targetId = aggregateId.split(':')[0];
      classId = (
        await tx.classSession.findUniqueOrThrow({
          where: { id: targetId },
          select: { classId: true },
        })
      ).classId;
    }
    if (eventType === 'STUDENT_STUDY_ENDED') type = 'ENROLLMENT_ENDED';
    if (eventType === 'ENROLLMENT_TRANSFERRED') {
      const transfer = await tx.enrollmentTransfer.findUniqueOrThrow({
        where: { id: aggregateId },
        select: { fromClassId: true, toClassId: true },
      });
      classId = transfer.toClassId;
      const classrooms = await tx.class.findMany({
        where: { id: { in: [transfer.fromClassId, transfer.toClassId] } },
      });
      for (const classroom of classrooms)
        if (classroom.teacherId)
          recipients.push({
            userId: classroom.teacherId,
            studentIds: scope.studentId ? [scope.studentId] : [],
          });
    }
    // The enrollment context also scopes STAFF work items to the affected child.
    recipients = recipients.map((recipient) => ({
      ...recipient,
      studentIds: scope.studentId ? [scope.studentId] : recipient.studentIds,
    }));
    await this.send(
      tx,
      actorId,
      type,
      targetKind,
      targetId,
      eventType === 'LEAVE_REQUESTED' ? 'Có đơn nghỉ cần xử lý' : 'Cập nhật học tập',
      body,
      recipients,
      classId,
      eventKey ?? `${eventType}:${aggregateId}:${body}`,
    );
  }

  async registration(
    tx: Prisma.TransactionClient,
    actorId: string,
    id: string,
    type: NotificationType,
  ): Promise<void> {
    const order = await tx.registrationOrder.findUniqueOrThrow({
      where: { id },
      select: {
        classId: true,
        targetStudent: { select: { id: true, parentProfile: { select: { userId: true } } } },
      },
    });
    const recipients: NotificationRecipient[] = order.targetStudent
      ? [{ userId: order.targetStudent.parentProfile.userId, studentIds: [order.targetStudent.id] }]
      : [];
    if (type === 'BILL_CREATED') recipients.push(...(await this.recipients.roles(tx, ['MANAGER'])));
    const messages = {
      BILL_CREATED: 'Có phiếu học phí mới cần xác nhận.',
      BILL_CANCELLED: 'Phiếu học phí đã được huỷ.',
      PAYMENT_CONFIRMED: 'Trung tâm đã xác nhận thanh toán học phí.',
    };
    const body = messages[type as keyof typeof messages] ?? 'Thông tin học phí đã được cập nhật.';
    await this.send(
      tx,
      actorId,
      type,
      'REGISTRATION',
      id,
      'Cập nhật học phí',
      body,
      recipients,
      order.classId,
      `${type}:${id}`,
    );
  }
}
