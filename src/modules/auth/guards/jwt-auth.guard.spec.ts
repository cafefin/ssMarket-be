import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../../users/user.entity.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

const secret = 'test-secret-test-secret-test-secret-1234';

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({ secret });
  const guard = new JwtAuthGuard(jwt);

  it('attaches the user for a valid access token', async () => {
    const token = await jwt.signAsync({
      sub: 'user-1',
      email: 'an@example.com',
      role: UserRole.User,
    });
    const request: Record<string, unknown> = {
      cookies: { access_token: token },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'user-1',
      email: 'an@example.com',
      role: UserRole.User,
    });
  });

  it('rejects a request without the cookie', async () => {
    await expect(
      guard.canActivate(contextFor({ cookies: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed with another secret', async () => {
    const forged = await new JwtService({
      secret: 'another-secret-another-secret-123456',
    }).signAsync({ sub: 'user-1' });

    await expect(
      guard.canActivate(contextFor({ cookies: { access_token: forged } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    const expired = await jwt.signAsync({ sub: 'user-1' }, { expiresIn: -10 });

    await expect(
      guard.canActivate(contextFor({ cookies: { access_token: expired } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
