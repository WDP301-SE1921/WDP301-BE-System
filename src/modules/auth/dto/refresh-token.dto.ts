import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token returned by login/register/refresh.',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJcm9sZV9pZCIsInR5cGUiOiJyZWZyZXNoIn0.signature',
  })
  @IsString()
  @MinLength(32)
  refreshToken!: string;
}
