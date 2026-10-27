import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';

export class SafeUserDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Current parent phone; only returned for PARENT accounts.',
  })
  phone?: string | null;

  @ApiProperty({ example: 'clx2r0x8a0000qzrmf6a6dr7p' })
  id!: string;

  @ApiProperty({ example: 'parent@example.com' })
  email!: string;

  @ApiProperty({ nullable: true, example: 'Nguyen Van A' })
  displayName!: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.PARENT })
  role!: UserRole;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status!: UserStatus;

  @ApiProperty({ nullable: true, example: '2026-10-02T03:00:00.000Z' })
  emailVerifiedAt!: Date | null;

  @ApiProperty({ example: false, description: 'Whether the user has an active avatar set.' })
  hasAvatar!: boolean;

  @ApiProperty({ example: '2026-09-23T03:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-09-23T03:00:00.000Z' })
  updatedAt!: Date;
}
