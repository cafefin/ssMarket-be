/**
 * The development sign-in exists only when BOTH conditions hold. Requiring an
 * explicit flag on top of NODE_ENV means a server that is merely started in
 * development mode by mistake still has no way around Google sign-in.
 */
export function isDevLoginEnabled(env: {
  NODE_ENV?: string;
  DEV_LOGIN_ENABLED?: string;
}): boolean {
  return env.NODE_ENV === 'development' && env.DEV_LOGIN_ENABLED === 'true';
}
