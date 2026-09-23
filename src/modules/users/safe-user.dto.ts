import { ApiProperty } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';

export class SafeUserDto {
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

  @ApiProperty({ example: '2026-09-23T03:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-09-23T03:00:00.000Z' })
  updatedAt!: Date;
}
