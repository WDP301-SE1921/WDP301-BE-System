import { ApiProperty } from '@nestjs/swagger';

import { SafeUserDto } from '../../users/safe-user.dto';

export class AuthTokensDto {
  @ApiProperty({
    description: 'JWT access token. Send it as Authorization: Bearer <accessToken>.',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJcm9sZV9pZCIsInR5cGUiOiJhY2Nlc3MifQ.signature',
  })
  accessToken!: string;

  @ApiProperty({
    description:
      'Refresh token used only with POST /api/v1/auth/refresh. It rotates after each use.',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJcm9sZV9pZCIsInR5cGUiOiJyZWZyZXNoIn0.signature',
  })
  refreshToken!: string;

  @ApiProperty({ example: 'Bearer', description: 'Token scheme for Authorization header.' })
  tokenType!: 'Bearer';

  @ApiProperty({ example: 900, description: 'Access token lifetime in seconds.' })
  expiresIn!: number;
}

export class AuthResponseDto {
  @ApiProperty({ type: SafeUserDto })
  user!: SafeUserDto;

  @ApiProperty({ type: AuthTokensDto })
  tokens!: AuthTokensDto;
}
