import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ApiErrorDto {
  @ApiProperty({ example: 'AUTH_INVALID_CREDENTIALS' })
  code!: string;

  @ApiProperty({ example: 'Invalid email or password' })
  message!: string;

  @ApiProperty({ example: '74a7e9ee-6a5f-4b07-b8db-f6d92019a61e' })
  requestId!: string;

  @ApiPropertyOptional()
  details?: unknown;
}

export class ApiErrorResponseDto {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ type: ApiErrorDto })
  error!: ApiErrorDto;
}
