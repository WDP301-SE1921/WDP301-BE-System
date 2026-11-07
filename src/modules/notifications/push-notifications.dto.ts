import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PushSubscriptionKeysDto {
  @ApiProperty() @IsString() @MinLength(16) @MaxLength(512) p256dh!: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(256) auth!: string;
}

export class SavePushSubscriptionDto {
  @ApiProperty()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(4096)
  endpoint!: string;

  @ApiProperty({ type: PushSubscriptionKeysDto })
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;
}

export class DeletePushSubscriptionDto {
  @ApiProperty()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(4096)
  endpoint!: string;
}

export class PushPublicKeyDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty() publicKey!: string;
}

export class PushSubscriptionResultDto {
  @ApiProperty() subscribed!: boolean;
}
