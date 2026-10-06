import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../modules/users/user.entity.js';
import { RolesGuard } from './roles.guard.js';

function contextFor(role: UserRole | undefined): ExecutionContext {
  return {
    getHandler: () => contextFor,
    getClass: () => RolesGuard,
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { id: 'u1', role } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);
  const requires = (roles: UserRole[] | undefined) =>
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);

  it('lets everyone through a route without @Roles', () => {
    requires(undefined);
    expect(guard.canActivate(contextFor(UserRole.User))).toBe(true);
  });

  it('lets a caller with a listed role through', () => {
    requires([UserRole.Admin]);
    expect(guard.canActivate(contextFor(UserRole.Admin))).toBe(true);
  });

  it('rejects a caller with another role', () => {
    requires([UserRole.Admin]);
    expect(() => guard.canActivate(contextFor(UserRole.User))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a request with no user', () => {
    requires([UserRole.Admin]);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
