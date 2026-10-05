import { GoogleAuthGuard } from './google-auth.guard.js';

describe('GoogleAuthGuard.handleRequest', () => {
  const guard = new GoogleAuthGuard();

  it('returns the identity when Passport succeeded', () => {
    const identity = { googleId: 'g-1' };

    expect(guard.handleRequest(null, identity)).toBe(identity);
  });

  it('returns null instead of throwing when Passport failed', () => {
    expect(guard.handleRequest(null, false)).toBeNull();
    expect(
      guard.handleRequest(new Error('token exchange failed'), false),
    ).toBeNull();
  });
});
