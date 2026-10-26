import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageDto } from '../academic/academic.dto';

export const NOTIFICATION_TYPES = [
  'ANNOUNCEMENT',
  'ASSIGNMENT_PUBLISHED',
  'ASSIGNMENT_REOPENED',
  'ANSWERS_PUBLISHED',
  'SUBMISSION_RECEIVED',
  'GRADE_PUBLISHED',
  'ATTENDANCE_FINALIZED',
  'SESSIONS_GENERATED',
  'SESSION_RESCHEDULED',
  'SESSION_CANCELLED',
  'TEACHER_CHANGED',
  'SUBSTITUTE_ASSIGNED',
  'LEAVE_REQUESTED',
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'LEAVE_CANCELLED',
  'LEAVE_ENDED_EARLY',
  'MAKEUP_BOOKED',
  'MAKEUP_CANCELLED',
  'MAKEUP_RESCHEDULED',
  'MAKEUP_COMPLETED',
  'MAKEUP_MISSED',
  'ENROLLMENT_TRANSFERRED',
  'ENROLLMENT_ENDED',
  'BILL_CREATED',
  'BILL_CANCELLED',
  'PAYMENT_CONFIRMED',
  'TUITION_REMINDER',
  'CURRICULUM_SUBMITTED',
  'CURRICULUM_CHANGES_REQUESTED',
  'CURRICULUM_APPROVED',
  'FEEDBACK_CREATED',
  'FEEDBACK_RESOLVED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export class NotificationQueryDto extends PageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() fromDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() toDate?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  unreadOnly?: boolean;
  @ApiPropertyOptional({ enum: [...NOTIFICATION_TYPES] })
  @IsOptional()
  @IsIn(NOTIFICATION_TYPES)
  type?: NotificationType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) studentId?: string;
}
export class NotificationTargetDto {
  @ApiProperty({
    enum: [
      'ASSIGNMENT',
      'SUBMISSION',
      'SESSION',
      'CLASS',
      'LEAVE',
      'MAKEUP',
      'ENROLLMENT',
      'REGISTRATION',
      'CURRICULUM_UNIT',
      'FEEDBACK',
    ],
  })
  kind!: string;
  @ApiProperty() id!: string;
}
export class NotificationContextDto {
  @ApiPropertyOptional() classId?: string;
  @ApiProperty({ type: [String] }) studentIds!: string[];
}
export class NotificationItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: [...NOTIFICATION_TYPES] }) type!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ type: NotificationTargetDto }) target!: NotificationTargetDto;
  @ApiProperty({ type: NotificationContextDto }) context!: NotificationContextDto;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) readAt!: Date | null;
}
export class NotificationPageDto {
  @ApiProperty({ type: [NotificationItemDto] }) items!: NotificationItemDto[];
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
}
export class UnreadCountDto {
  @ApiProperty() unreadCount!: number;
}
export class ReadAllDto extends UnreadCountDto {
  @ApiProperty() updatedCount!: number;
}
