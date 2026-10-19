import { ApiProperty } from '@nestjs/swagger';

export class RealtimeTicketDto {
  @ApiProperty({ description: 'Send as `auth.token` in the /notifications socket handshake.' })
  token!: string;

  @ApiProperty({ example: 60, description: 'Seconds the ticket can be used to connect.' })
  expiresIn!: number;
}
