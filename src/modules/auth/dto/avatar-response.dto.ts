import { ApiProperty } from '@nestjs/swagger';

export class AvatarUrlResponseDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Signed URL for user avatar, or null if no avatar is set.',
    example: 'http://localhost:9000/edugrade/avatars/user123/uuid.png?...',
  })
  url!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Lifetime in seconds of the signed URL, or null if no avatar is set.',
    example: 900,
  })
  expiresIn!: number | null;
}

export class DeleteAvatarResponseDto {
  @ApiProperty({
    example: true,
    description: 'Indicates whether the avatar was deleted or cleared.',
  })
  deleted!: true;
}
