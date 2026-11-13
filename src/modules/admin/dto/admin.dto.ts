import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const blankToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  return text ? text : null;
};

export const ADMIN_CREATABLE_ROLES = [
  'ADMIN',
  'MANAGER',
  'STAFF',
  'TEACHER',
  'CURRICULUM_DESIGNER',
  'PARENT',
] as const;
export type AdminCreatableRole = (typeof ADMIN_CREATABLE_ROLES)[number];

const ALL_ROLES = ADMIN_CREATABLE_ROLES;

/** Loại bản ghi xóa mềm được qua /admin/records/:kind/:id. */
export const RECORD_KINDS = [
  'account',
  'parent',
  'student',
  'subject',
  'program',
  'class',
  'room',
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/** Kỳ thống kê của dashboard Admin (ngày trung tâm). Mặc định đầu tháng → hôm nay. */
export class AdminDashboardQueryDto {
  @ApiPropertyOptional({ example: '2026-11-01', description: 'First day (center local date).' })
  @IsOptional()
  @IsDateString({ strict: true })
  fromDate?: string;

  @ApiPropertyOptional({
    example: '2026-11-13',
    description: 'Last day inclusive; later than today is clamped to today.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  toDate?: string;
}

export class AdminAccountQueryDto {
  @ApiPropertyOptional({
    description: 'Accepted for consistency with other lists; this endpoint is always paginated.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  paginated?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ description: 'Partial email or display name.' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: ALL_ROLES })
  @IsOptional()
  @IsIn(ALL_ROLES)
  role?: (typeof ALL_ROLES)[number];

  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}

export class CreateAdminAccountDto {
  @ApiProperty({ example: 'staff@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  displayName!: string;

  @ApiProperty({ enum: ADMIN_CREATABLE_ROLES })
  @IsIn(ADMIN_CREATABLE_ROLES)
  role!: AdminCreatableRole;

  @ApiProperty({
    minLength: 8,
    maxLength: 72,
    description: 'Initial password, at most 72 UTF-8 bytes. It is never returned.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiPropertyOptional({ description: 'Only stored for PARENT accounts (parent profile phone).' })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;
}

export class UpdateAdminAccountDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  displayName!: string;
}

export class SetAccountStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  @IsIn(['ACTIVE', 'DISABLED'])
  status!: 'ACTIVE' | 'DISABLED';

  @ApiProperty({ description: 'Required; stored in the audit log.' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  reason!: string;
}

export class UpdateCenterDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || null : value,
  )
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  openingHours?: string | null;
}

export class RecordReasonDto {
  @ApiProperty({ description: 'Required; stored with the record and in the audit log.' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  reason!: string;
}

export class CreateAdminStudentDto {
  @ApiProperty({ description: 'User id of the parent account.' })
  @IsString()
  @MinLength(1)
  parentId!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fullName!: string;

  @ApiProperty({ minimum: 6, maximum: 9 })
  @Type(() => Number)
  @IsInt()
  @Min(6)
  @Max(9)
  grade!: number;

  @ApiPropertyOptional({ example: '2013-04-12' })
  @Transform(blankToNull)
  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string | null;
}
