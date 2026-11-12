import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class DeleteAccountDto {
  @ApiProperty({ description: 'Current password, required to confirm the deletion.' })
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password!: string;
}

export class DeleteAccountResponseDto {
  @ApiProperty({ example: true })
  deleted!: true;
}
