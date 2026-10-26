import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import {
  AssignmentKind,
  TestType,
  AttendanceStatus,
  FeedbackStatus,
  LeaveKind,
  OutboxStatus,
  QuestionKind,
  RequestStatus,
} from '@prisma/client';

export class PageDto {
  @ApiPropertyOptional({
    description: 'Return items, page, limit and total; omitted keeps the legacy array.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  paginated?: boolean;
  @ApiPropertyOptional({ default: 1, maximum: 1000000 }) @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @ApiPropertyOptional({ default: 20 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export class StudentPageDto extends PageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(191) studentId?: string;
}
export class EmailDeliveryFilterDto extends PageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) eventType?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() fromDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() toDate?: string;
  @ApiPropertyOptional({ enum: OutboxStatus, description: 'Only deliveries in this state.' })
  @IsOptional()
  @IsEnum(OutboxStatus)
  status?: OutboxStatus;
}
export class LeaveFilterDto extends PageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) search?: string;
  @ApiPropertyOptional({ enum: RequestStatus })
  @IsOptional()
  @IsEnum(RequestStatus)
  status?: RequestStatus;
  @ApiPropertyOptional({ enum: LeaveKind }) @IsOptional() @IsEnum(LeaveKind) kind?: LeaveKind;
  @ApiPropertyOptional({ description: 'Student profile id.' })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  studentId?: string;
  @ApiPropertyOptional({ example: '2026-10-01', description: 'Leaves ending on/after this day.' })
  @IsOptional()
  @IsDateString({ strict: true })
  fromDate?: string;
  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Leaves starting on/before this day.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  toDate?: string;
}
export class MakeupSourceFilterDto extends PageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(191) classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() fromDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() toDate?: string;
  @ApiPropertyOptional({ description: 'Student profile id.' })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  studentId?: string;

  @ApiPropertyOptional({
    description:
      'Only absences already recorded in completed sessions (excludes future sessions that can be made up in advance).',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  completedOnly?: boolean;
}
export class AttendanceQueryDto extends PageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() fromDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() toDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() studentId?: string;
}
export class ProgramDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) name!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) subject!: string;
  @ApiProperty() @IsInt() @Min(6) @Max(9) grade!: number;
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 14,
    description: 'Weekly slots; optional during migration.',
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(14)
  sessionsPerWeek?: number;
}
export class ClassDto {
  @ApiProperty() @IsString() @MinLength(1) programId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) name!: string;
  @ApiProperty() @IsString() @MinLength(1) teacherId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1000) capacity!: number;
  @ApiProperty() @IsNumber() @Min(0) monthlyFee!: number;
}
export class LessonDto {
  @ApiProperty() @IsString() @MinLength(1) programId!: string;
  @ApiProperty() @IsString() @MinLength(1) designerId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(50000) content!: string;
  @ApiProperty() @IsInt() @Min(1) sequence!: number;
}
export class SessionDto {
  @ApiProperty() @IsString() @MinLength(1) classId!: string;
  @ApiProperty() @IsString() @MinLength(1) lessonId!: string;
  @ApiProperty() @IsString() @MinLength(1) teacherId!: string;
  @ApiProperty() @IsDateString() startsAt!: string;
  @ApiProperty() @IsDateString() endsAt!: string;
}
export class ReasonDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}
export class LeaveDto extends ReasonDto {
  @ApiProperty() @IsString() @MinLength(1) enrollmentId!: string;
  @ApiProperty({ enum: LeaveKind }) @IsEnum(LeaveKind) kind!: LeaveKind;
  @ApiPropertyOptional() @IsOptional() @IsString() sessionId?: string;
  @ApiProperty() @IsDateString({ strict: true }) fromDate!: string;
  @ApiProperty() @IsDateString({ strict: true }) toDate!: string;
}
export class DecisionDto extends ReasonDto {
  @ApiProperty() @IsBoolean() approve!: boolean;
}
export class TransferDto extends ReasonDto {
  @ApiProperty() @IsString() @MinLength(1) targetClassId!: string;
  @ApiProperty() @IsDateString() effectiveAt!: string;
}
export class ReactivateStudentDto extends ReasonDto {}
export class EndLeaveEarlyDto extends ReasonDto {
  @ApiProperty({ description: 'First local study date no longer covered by the pause.' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effectiveDate!: string;
}
export class MakeupDto {
  @ApiProperty() @IsString() @MinLength(1) originalParticipantId!: string;
  @ApiProperty() @IsString() @MinLength(1) targetSessionId!: string;
}
export class RescheduleMakeupDto extends ReasonDto {
  @ApiProperty() @IsString() @MinLength(1) targetSessionId!: string;
}
export class AttendanceItemDto {
  @ApiProperty() @IsString() @MinLength(1) participantId!: string;
  @ApiProperty({ enum: AttendanceStatus }) @IsEnum(AttendanceStatus) status!: AttendanceStatus;
}
export class AttendanceDto {
  @ApiProperty({ type: [AttendanceItemDto] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => AttendanceItemDto)
  items!: AttendanceItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) summary?: string;
}
export class FeedbackDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(5000) content!: string;
}
export class ResolveFeedbackDto {
  @ApiPropertyOptional() @IsOptional() @IsString() resolutionLessonId?: string;
  @ApiProperty({ enum: FeedbackStatus }) @IsEnum(FeedbackStatus) status!: FeedbackStatus;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(5000) response!: string;
}

export class LessonRevisionDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(50000) content!: string;
}

export class SubmissionWindowDto {
  @ApiProperty() @IsDateString() dueAt!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(10) maxAttempts!: number;
}
export class QuestionDto {
  @ApiProperty({ enum: QuestionKind }) @IsEnum(QuestionKind) kind!: QuestionKind;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(10000) prompt!: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  choices?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) correctAnswer?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10000) rubric?: string;
  @ApiPropertyOptional({ description: 'Approved CLO measured by this question' })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(191) outcomeId?: string;
  @ApiProperty() @IsNumber() @Min(0.01) @Max(100) maxScore!: number;
}
export class AssignmentDto {
  @ApiPropertyOptional({ enum: AssignmentKind, default: 'HOMEWORK' })
  @IsOptional()
  @IsEnum(AssignmentKind)
  kind?: AssignmentKind;
  @ApiPropertyOptional({ enum: TestType }) @IsOptional() @IsEnum(TestType) testType?: TestType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) sessionId?: string;
  @ApiProperty() @IsString() @MinLength(1) classId!: string;
  @ApiPropertyOptional({ description: 'Approved CLO set for this assignment' })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(191) outcomeSetId?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @ApiProperty() @IsString() @MaxLength(10000) instructions!: string;
  @ApiProperty() @IsDateString() dueAt!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(10) maxAttempts!: number;
  @ApiProperty({ type: [QuestionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions!: QuestionDto[];
}
export class AssignmentImportDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(191) classId!: string;
}

export class OutcomeSourceReviewDto {
  @ApiProperty({ description: 'Exact requirement, section and printed page of the source' })
  @IsString()
  @MinLength(12)
  @MaxLength(255)
  sourceLocator!: string;

  @ApiProperty({ description: 'Teacher explanation of how this CLO follows the cited requirement' })
  @IsString()
  @MinLength(12)
  @MaxLength(5000)
  sourceNote!: string;
}

export class OutcomeSetCreateDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(191) programId!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) level!: string;
  @ApiPropertyOptional({ description: 'Copy CLOs and lesson links from this set of the same program' })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(191) copyFromId?: string;
}

export class OutcomeChangeRequestDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}

export class LearningOutcomeWriteDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(64) code!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(255) title!: string;
  @ApiProperty() @IsString() @MinLength(12) @MaxLength(5000) statement!: string;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(255) sourceTitle!: string;
  @ApiProperty() @IsString() @MinLength(12) @MaxLength(2000) sourceUrl!: string;
  @ApiProperty() @IsString() @MinLength(12) @MaxLength(255) sourceLocator!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) sourceNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;
}

export class LessonOutcomeWriteDto {
  @ApiProperty({ type: [String] })
  @IsArray() @ArrayUnique() @IsString({ each: true })
  outcomeIds!: string[];
}
export class RecipientsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsString({ each: true })
  enrollmentIds!: string[];
}
export class AnswerDto {
  @ApiProperty() @IsString() @MinLength(1) questionId!: string;
  @ApiProperty() @IsString() @MaxLength(20000) answer!: string;
}
export class SubmissionDto {
  @ApiProperty() @IsString() @MinLength(1) recipientId!: string;
  @ApiProperty({ type: [AnswerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers!: AnswerDto[];
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsString({ each: true })
  fileIds?: string[];
}
export class ScoreDto {
  @ApiProperty() @IsString() @MinLength(1) questionId!: string;
  @ApiProperty() @IsNumber() @Min(0) @Max(100) score!: number;
  @ApiProperty() @IsString() @MaxLength(5000) feedback!: string;
}
export class GradeDto {
  @ApiProperty({ type: [ScoreDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ScoreDto)
  scores!: ScoreDto[];
  @ApiProperty() @IsString() @MaxLength(5000) feedback!: string;
}
export class ReportDto {
  @ApiProperty() @IsString() @MinLength(1) classId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() studentId?: string;
  @ApiProperty() @IsDateString() from!: string;
  @ApiProperty() @IsDateString() to!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() includeAi?: boolean;
}
export enum AnalyticsBucket {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
}
export class AnalyticsQueryDto {
  @ApiProperty() @IsDateString() from!: string;
  @ApiProperty() @IsDateString() to!: string;
  @ApiProperty({ enum: AnalyticsBucket }) @IsEnum(AnalyticsBucket) bucket!: AnalyticsBucket;
  @ApiPropertyOptional() @IsOptional() @IsString() classId?: string;
}
export class BulkReportExportDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  reportIds!: string[];
}
export class AnnouncementDto {
  @ApiProperty() @IsString() @MinLength(1) classId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(10000) content!: string;
}
export class ReminderDto {
  @ApiProperty() @IsDateString() through!: string;
}
