import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
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

export class ProgramDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  subject!: string;

  @ApiProperty()
  @IsInt()
  @Min(6)
  @Max(9)
  grade!: number;
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
  @ArrayMinSize(1)
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
