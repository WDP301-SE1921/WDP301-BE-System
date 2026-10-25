import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AssignmentKind,
  AssignmentStatus,
  AttendanceStatus,
  EnrollmentStatus,
  FeedbackStatus,
  GradeStatus,
  LessonStatus,
  MakeupStatus,
  OutcomeSetStatus,
  ParticipantKind,
  SessionStatus,
  TestType,
} from '@prisma/client';
import { PageDto } from './academic.dto';

export class SearchPageDto extends PageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;
}
export class DateListDto extends SearchPageDto {
  @ApiPropertyOptional({ description: 'Inclusive UTC+7 day or exact ISO timestamp' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;
  @ApiPropertyOptional({ description: 'Inclusive UTC+7 day or exact ISO timestamp' })
  @IsOptional()
  @IsDateString()
  toDate?: string;
}
export class AcademicProgramQueryDto extends SearchPageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() subjectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subject?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(6) @Max(9) grade?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;
}
export class AcademicClassQueryDto extends AcademicProgramQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() programId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() teacherId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() roomId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isOpen?: boolean;
}
export class LessonQueryDto extends SearchPageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() programId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() unitId?: string;
  @ApiPropertyOptional({ enum: LessonStatus })
  @IsOptional()
  @IsEnum(LessonStatus)
  status?: LessonStatus;
}
export class AcademicSessionQueryDto extends DateListDto {
  @ApiPropertyOptional() @IsOptional() @IsString() classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() teacherId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() lessonId?: string;
  @ApiPropertyOptional({ enum: SessionStatus })
  @IsOptional()
  @IsEnum(SessionStatus)
  status?: SessionStatus;
}
export class FeedbackQueryDto extends DateListDto {
  @ApiPropertyOptional() @IsOptional() @IsString() lessonId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() teacherId?: string;
  @ApiPropertyOptional({ enum: FeedbackStatus })
  @IsOptional()
  @IsEnum(FeedbackStatus)
  status?: FeedbackStatus;
}
export class EnrollmentQueryDto extends SearchPageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() studentId?: string;
  @ApiPropertyOptional({ enum: EnrollmentStatus })
  @IsOptional()
  @IsEnum(EnrollmentStatus)
  status?: EnrollmentStatus;
}
export class RosterQueryDto extends SearchPageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() studentId?: string;
  @ApiPropertyOptional({ enum: AttendanceStatus })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  attendance?: AttendanceStatus;
  @ApiPropertyOptional({ enum: ParticipantKind })
  @IsOptional()
  @IsEnum(ParticipantKind)
  kind?: ParticipantKind;
}
export class AssignmentQueryDto extends DateListDto {
  @ApiPropertyOptional() @IsOptional() @IsString() studentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sessionId?: string;
  @ApiPropertyOptional({ enum: AssignmentStatus })
  @IsOptional()
  @IsEnum(AssignmentStatus)
  status?: AssignmentStatus;
  @ApiPropertyOptional({ enum: AssignmentKind })
  @IsOptional()
  @IsEnum(AssignmentKind)
  kind?: AssignmentKind;
  @ApiPropertyOptional({ enum: TestType }) @IsOptional() @IsEnum(TestType) testType?: TestType;
}
export class SubmissionQueryDto extends DateListDto {
  @ApiPropertyOptional() @IsOptional() @IsString() studentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() recipientId?: string;
  @ApiPropertyOptional({ enum: GradeStatus })
  @IsOptional()
  @IsEnum(GradeStatus)
  gradeStatus?: GradeStatus;
}
export class MakeupQueryDto extends DateListDto {
  @ApiPropertyOptional() @IsOptional() @IsString() studentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() classId?: string;
  @ApiPropertyOptional({ enum: MakeupStatus })
  @IsOptional()
  @IsEnum(MakeupStatus)
  status?: MakeupStatus;
}
export class ClassContentQueryDto extends DateListDto {
  @ApiPropertyOptional() @IsOptional() @IsString() classId?: string;
}
export class OutcomeSetQueryDto extends SearchPageDto {
  @ApiPropertyOptional({ enum: OutcomeSetStatus })
  @IsOptional()
  @IsEnum(OutcomeSetStatus)
  status?: OutcomeSetStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() level?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) version?: number;
}
export class StudentGradeQueryDto extends DateListDto {
  @ApiPropertyOptional() @IsOptional() @IsString() classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subject?: string;
  @ApiPropertyOptional({ enum: AssignmentKind })
  @IsOptional()
  @IsEnum(AssignmentKind)
  kind?: AssignmentKind;
}
export class ParentCurriculumQueryDto extends DateListDto {
  @ApiPropertyOptional() @IsOptional() @IsString() programId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subject?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(6) @Max(9) grade?: number;
}
