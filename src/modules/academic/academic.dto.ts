import { Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';
import {
  AttendanceStatus,
  FeedbackStatus,
  LeaveKind,
  QuestionKind,
  RequestStatus,
} from '@prisma/client';

export class PageDto {
  @ApiPropertyOptional({ default: 1 }) @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export class LeaveFilterDto extends PageDto {
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
  @ApiPropertyOptional({ description: 'Student profile id.' })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  studentId?: string;
}
export class ProgramDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) name!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) subject!: string;
  @ApiProperty() @IsInt() @Min(6) @Max(9) grade!: number;
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
export class MakeupDto {
  @ApiProperty() @IsString() @MinLength(1) originalParticipantId!: string;
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
  @ApiProperty() @IsNumber() @Min(0.01) @Max(100) maxScore!: number;
}
export class AssignmentDto {
  @ApiProperty() @IsString() @MinLength(1) classId!: string;
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
