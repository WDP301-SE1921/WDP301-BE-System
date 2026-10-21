import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

function normalizeEmail(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export class LoginDto {
  @ApiProperty({
    example: 'parent@example.com',
    description: 'Email is trimmed and normalized to lowercase by the API.',
  })
  @Transform(({ value }: { value: unknown }) => normalizeEmail(value))
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    example: 'StrongPass123!',
    minLength: 8,
    maxLength: 72,
    description:
      'Password must be at most 72 UTF-8 bytes because bcrypt truncates after that limit.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
