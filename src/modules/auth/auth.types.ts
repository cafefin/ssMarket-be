import type { UserRole } from '../users/user.entity.js';

/** What Google told us about the person signing in. */
export interface GoogleIdentity {
  googleId: string;
  email: string;
  emailVerified: boolean;
  /** The Google Workspace domain (`hd` claim); null for personal accounts. */
  hostedDomain: string | null;
  name: string;
  avatarUrl: string | null;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
}

/** The authenticated user attached to the request by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
