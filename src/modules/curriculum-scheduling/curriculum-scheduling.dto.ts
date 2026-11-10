import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { PageDto } from '../academic/academic.dto';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsIn,
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  ValidateNested,
  IsBoolean,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCurriculumUnitDto {
  @ApiProperty() @IsString() @MinLength(1) programId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @ApiProperty({ example: '2026-11-01' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromDate!: string;
  @ApiProperty({ example: '2026-11-30' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toDate!: string;
}

export class UpdateCurriculumUnitDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) expectedRevision?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(255) title?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromDate?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toDate?: string;
}

export class CurriculumUnitFilterDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() fromDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() toDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() programId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(6) @Max(9) grade?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() subject?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ARCHIVED'])
  status?: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'ARCHIVED';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  paginated?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
}

export class ReviewNoteDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}

export class SubmitCurriculumUnitDto {
  @ApiProperty() @IsString() @MinLength(1) reviewerTeacherId!: string;
}

export class TechnicalReviewDto {
  @ApiProperty() @IsBoolean() approved!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @ApiProperty() @IsInt() @Min(1) expectedRevision!: number;
}

export class ReviseCurriculumUnitDto extends OmitType(CreateCurriculumUnitDto, [
  'programId',
] as const) {}

export class LessonOrderDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  orderedLessonIds!: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) expectedRevision?: number;
}

export class SessionRescheduleDto {
  @ApiPropertyOptional({
    description: 'Optional replacement room; omitted retains the current room.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  roomId?: string;
  @ApiProperty({ example: '2026-11-04T11:00:00.000Z' })
  @IsDateString()
  @Matches(/T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
  startsAt!: string;
  @ApiProperty({ example: '2026-11-04T13:00:00.000Z' })
  @IsDateString()
  @Matches(/T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
  endsAt!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
  @ApiProperty() @IsInt() @Min(1) expectedRevision!: number;
}

export class SessionCancelDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
  @ApiProperty() @IsInt() @Min(1) expectedRevision!: number;
  @ApiPropertyOptional({
    default: false,
    description:
      'true: every later session of the same curriculum takes the previous lesson and the last lesson is pushed out (pushedLesson). false keeps the old behaviour: cancel and drop the lesson.',
  })
  @IsOptional()
  @IsBoolean()
  shiftLessons?: boolean;
}

export class SessionCancelPreviewDto {
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() shiftLessons?: boolean;
}

export class SessionBulkCancelPreviewDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(191, { each: true })
  sessionIds!: string[];
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() shiftLessons?: boolean;
  @ApiPropertyOptional({ description: 'Accepted so the cancel form body can be previewed as is.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class SessionBulkCancelDto extends OmitType(SessionBulkCancelPreviewDto, ['reason']) {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CenterClosureDto {
  @ApiProperty({ example: '2027-02-05', description: 'First closed local (UTC+7) date' })
  @IsDateString({ strict: true })
  @Matches(LOCAL_DATE)
  fromDate!: string;
  @ApiProperty({ example: '2027-02-12', description: 'Last closed local date, inclusive' })
  @IsDateString({ strict: true })
  @Matches(LOCAL_DATE)
  toDate!: string;
  @ApiProperty({ example: 'Tết Nguyên đán' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  reason!: string;
}

export class UpdateCenterClosureDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) @Matches(LOCAL_DATE) fromDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) @Matches(LOCAL_DATE) toDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(255) reason?: string;
  @ApiProperty() @IsInt() @Min(1) expectedRevision!: number;
}

export class CenterClosureQueryDto extends PageDto {
  @ApiPropertyOptional({ description: 'Closures that end on or after this local date' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(LOCAL_DATE)
  fromDate?: string;
  @ApiPropertyOptional({ description: 'Closures that start on or before this local date' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(LOCAL_DATE)
  toDate?: string;
}

export class ImportRowDto {
  @ApiProperty() @IsInt() @Min(1) rowNumber!: number;
  @ApiProperty() @IsIn(['LESSON', 'MONTHLY_TEST']) kind!: 'LESSON' | 'MONTHLY_TEST';
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) sequence?: number | null;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(50000) content!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) monthKey?: string | null;
}

export class ImportCommitDto {
  @ApiProperty() @IsString() previewId!: string;
  @ApiProperty() @IsInt() @Min(1) expectedRevision!: number;
  @ApiProperty({ enum: ['APPEND', 'REPLACE'] }) @IsIn(['APPEND', 'REPLACE']) mode!:
    'APPEND' | 'REPLACE';
  @ApiProperty({ type: [ImportRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows!: ImportRowDto[];
}

export class CurriculumLessonDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) expectedRevision?: number;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(50000) content!: string;
  @ApiProperty() @IsInt() @Min(1) sequence!: number;
}

export class MonthlyTestDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) expectedRevision?: number;
  @ApiProperty({ example: '2026-11' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) monthKey!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) title!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(50000) content!: string;
}

export class ScheduleRangeDto {
  @ApiProperty() @IsString() @MinLength(1) curriculumUnitId!: string;
  @ApiProperty({ example: '2026-11-01' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromDate!: string;
  @ApiProperty({ example: '2026-11-30' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() previewId?: string;
}

export class SessionQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() teacherId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() roomId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() lessonId?: string;
  @ApiPropertyOptional({ enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED'] }) @IsOptional() @IsIn(['SCHEDULED', 'COMPLETED', 'CANCELLED']) status?: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  @ApiPropertyOptional({
    description: 'Return pagination metadata; omitted keeps the legacy array.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  paginated?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() classId?: string;
  @ApiPropertyOptional({ description: 'Parent-owned student profile id.' })
  @IsOptional()
  @IsString()
  studentId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromDate?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toDate?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
