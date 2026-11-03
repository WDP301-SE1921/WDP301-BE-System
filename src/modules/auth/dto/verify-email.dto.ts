import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

/** Send `email` with `code`, or the long `token` of emails sent before 6-digit codes. */
export class VerifyEmailDto {
  @ApiPropertyOptional({
    description:
      'Long token from verification emails sent before 6-digit codes. Takes precedence over email and code.',
  })
  @ValidateIf((body: VerifyEmailDto) => body.token !== undefined || body.code === undefined)
  @IsString()
  @MinLength(32)
  token?: string;

  @ApiPropertyOptional({ example: 'parent@example.com', description: 'Required with code.' })
  @ValidateIf((body: VerifyEmailDto) => body.token === undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({
    example: '123456',
    description: '6-digit code from the verification email. Required with email.',
  })
  @ValidateIf((body: VerifyEmailDto) => body.token === undefined)
  @Matches(/^\d{6}$/)
  code?: string;
}
