import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(72) currentPassword!: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(72) newPassword!: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() token!: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(72) newPassword!: string;
}
