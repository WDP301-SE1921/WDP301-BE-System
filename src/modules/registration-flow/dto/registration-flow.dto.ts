import { Transform, Type } from 'class-transformer';
import type { UserStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class PageDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class ClassRosterQueryDto extends PageDto {
  @ApiPropertyOptional({
    description: 'Roster effective instant. Defaults to the current time.',
    example: '2026-10-12T10:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  at?: string;
}

export class CreateStudentDto {
  @ApiProperty({ example: 'Nguyen An' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fullName!: string;

  @ApiProperty({ example: 8 })
  @IsInt()
  @Min(6)
  @Max(9)
  grade!: number;

  @ApiPropertyOptional({ example: '2013-04-20' })
  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string;
}

export class UpdateStudentDto {
  @ApiPropertyOptional({ example: 'Nguyen An' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fullName?: string;

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @IsInt()
  @Min(6)
  @Max(9)
  grade?: number;

  @ApiPropertyOptional({ example: '2013-04-20' })
  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string | null;
}

export class ParentLookupDto {
  @ApiProperty({ example: 'parent@example.com' })
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

export class ParentSearchDto {
  @ApiProperty({
    example: 'ng',
    minLength: 2,
    maxLength: 255,
    description: 'Partial email, trimmed and lowercased; a complete email is not required.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  email!: string;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit = 10;
}

export class ParentSuggestionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ nullable: true, type: String })
  displayName!: string | null;

  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  status!: UserStatus;
}

export class ProgramDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  subject?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() subjectId?: string;

  @ApiProperty()
  @IsInt()
  @Min(6)
  @Max(9)
  grade!: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 14,
    description: 'Optional during migration; null is invalid.',
  })
  @ValidateIf((_input: unknown, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(14)
  sessionsPerWeek?: number;
}

export class UpdateProgramDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  subject?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() subjectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(6)
  @Max(9)
  grade?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 14,
    description: 'Omit to preserve the existing frequency; null is invalid.',
  })
  @ValidateIf((_input: unknown, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(14)
  sessionsPerWeek?: number;
}

export class ProgramFilterDto extends PageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subjectId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(6) @Max(9) grade?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;
}

export class ClassDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  programId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teacherId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() roomId?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  monthlyFee!: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isOpen?: boolean;
}

export class UpdateClassDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teacherId?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsString() roomId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyFee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOpen?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class RoomDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(191) name!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(10000) capacity!: number;
}

export class UpdateRoomDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(191) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10000) capacity?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class TeacherAssignmentDto {
  @ApiProperty() @IsString() @MinLength(1) teacherId!: string;
  @ApiProperty() @IsDateString() effectiveAt!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}

export class SessionSubstitutionDto {
  @ApiProperty() @IsString() @MinLength(1) teacherId!: string;
  @ApiProperty() @IsInt() @Min(1) expectedRevision!: number;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}

export class ScheduleConfirmationDto {
  @ApiProperty() @IsBoolean() confirmed!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

export class ClassScheduleSlotDto {
  @ApiProperty({ description: 'ISO weekday. Monday is 1 and Sunday is 7.', example: 2 })
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: number;

  @ApiProperty({ example: '18:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime!: string;

  @ApiProperty({ example: '20:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime!: string;
}

export class ReplaceClassSchedulesDto {
  @ApiProperty({ type: [ClassScheduleSlotDto] })
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => ClassScheduleSlotDto)
  schedules!: ClassScheduleSlotDto[];
}

export class ClassFilterDto extends PageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  studentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() programId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(6) @Max(9) grade?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isOpen?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: '2026-10-05' })
  @IsOptional()
  @IsDateString({ strict: true })
  startDate?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  packageMonths?: number;
}

export class CreateRegistrationDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  targetStudentId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  classId!: string;

  @ApiProperty({ example: '2026-10-05' })
  @IsDateString({ strict: true })
  startDate!: string;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  @Max(12)
  packageMonths!: number;
}

export class ConfirmPaymentDto {
  @ApiPropertyOptional({ example: 'RCPT-001' })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  receiptNumber?: string;
}

export class ListRegistrationsDto extends PageDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'COMPLETED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'COMPLETED', 'CANCELLED'])
  status?: 'DRAFT' | 'COMPLETED' | 'CANCELLED';

  @ApiPropertyOptional({ enum: ['me'], description: 'Only drafts created by the caller.' })
  @IsOptional()
  @IsIn(['me'])
  createdBy?: 'me';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(191)
  classId?: string;

  @ApiPropertyOptional({ description: 'Parent email, student name or receipt number.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'Created on/after, center local date.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  fromDate?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Created on/before, center local date.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  toDate?: string;
}

export class ListPaymentsDto extends PageDto {
  @ApiPropertyOptional({ description: 'Receipt number, parent email or student name.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'Confirmed on/after, center local date.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  fromDate?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Confirmed on/before, center local date.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  toDate?: string;
}

export class ListStudentsDto extends PageDto {
  @ApiPropertyOptional({ description: 'Student name or parent email.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ example: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(6)
  @Max(9)
  grade?: number;

  @ApiPropertyOptional({ description: 'Parent user id.' })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  parentUserId?: string;

  @ApiPropertyOptional({
    enum: ['no-class', 'long-leave', 'pending-makeup'],
    description:
      'no-class: active students without a current enrollment; long-leave: approved period pause covering today; pending-makeup: recorded absence not made up.',
  })
  @IsOptional()
  @IsIn(['no-class', 'long-leave', 'pending-makeup'])
  quick?: 'no-class' | 'long-leave' | 'pending-makeup';
}
