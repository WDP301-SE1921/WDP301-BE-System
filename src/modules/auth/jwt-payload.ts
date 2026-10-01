import type { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  sid: string;
  jti: string;
  type: 'access' | 'refresh';
  role: UserRole;
}
