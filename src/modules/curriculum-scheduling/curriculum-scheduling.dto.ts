import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsIn,
  IsArray,
  ArrayMinSize,
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
  @ApiPropertyOptional() @IsOptional() @IsString() programId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(6) @Max(9) grade?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() subject?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ARCHIVED'])
  status?: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'ARCHIVED';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
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

export class LessonOrderDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  orderedLessonIds!: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) expectedRevision?: number;
}

export class SessionRescheduleDto {
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
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
