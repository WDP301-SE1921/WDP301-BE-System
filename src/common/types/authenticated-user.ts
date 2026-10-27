import type { UserRole } from '@prisma/client';
import type { UserStatus } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  hasAvatar: boolean;
  createdAt: Date;
  updatedAt: Date;
  sessionId: string;
}
