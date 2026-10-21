import type { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  sid: string;
  jti: string;
  /** `realtime`: short-lived ticket that only opens a notification socket (web clients). */
  type: 'access' | 'refresh' | 'realtime';
  role: UserRole;
}
